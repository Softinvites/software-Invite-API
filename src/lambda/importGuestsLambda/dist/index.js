import { parseCsvExcel } from "./parseCsvExcel.js";
import { invokeLambda } from "./lambdaUtils.js";
import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { buildInvitationEmail } from "./buildInvitationEmail.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import fetch from "node-fetch";
const s3 = new S3Client({ region: process.env.AWS_REGION });
const { QR_LAMBDA_FUNCTION_NAME, PNG_CONVERT_LAMBDA, EMAIL_LAMBDA_FUNCTION_NAME, ADMIN_EMAIL, } = process.env;
/* ------------------------------ */
/* 🔧 HELPER FUNCTIONS */
/* ------------------------------ */
// Function to prepare email attachments with S3 keys
async function prepareEmailAttachments(compressedIVUrl, eventName) {
    if (!compressedIVUrl)
        return [];
    const s3Key = compressedIVUrl.split('.amazonaws.com/')[1];
    if (!s3Key)
        return [];
    return [{
            filename: `${eventName.replace(/[^a-zA-Z0-9-_]/g, '_')}_invitation.jpg`,
            s3Key: s3Key
        }];
}
// Function to compress and upload IV to S3 once
async function prepareIVAttachment(eventId, eventName, originalIVUrl) {
    try {
        const response = await fetch(originalIVUrl);
        if (!response.ok)
            throw new Error(`Failed to fetch IV: ${response.statusText}`);
        const imageBuffer = Buffer.from(await response.arrayBuffer());
        // Compress image using Sharp
        const compressedBuffer = await sharp(imageBuffer)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 60 })
            .toBuffer();
        const compressedKey = `events/${eventId}/compressed_iv_${Date.now()}.jpg`;
        await s3.send(new PutObjectCommand({
            Bucket: 'softinvites-assets',
            Key: compressedKey,
            Body: compressedBuffer,
            ContentType: 'image/jpeg'
        }));
        return `https://softinvites-assets.s3.us-east-2.amazonaws.com/${compressedKey}`;
    }
    catch (error) {
        console.error('IV compression failed:', error);
        return originalIVUrl;
    }
}
/* ------------------------------ */
/* 🔁 SAFE INVOKE WITH RETRIES */
/* ------------------------------ */
async function safeInvoke(functionName, payload, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await invokeLambda(functionName, payload, true);
        }
        catch (err) {
            console.error(`Invoke failed (${i + 1}/${retries}) → ${functionName}`, err);
            if (i === retries - 1)
                throw err;
            await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
    }
}
/* ------------------------------ */
/* ✅ MAIN IMPORT HANDLER */
/* ------------------------------ */
export const handler = async (event) => {
    try {
        console.log("✅ Import Started");
        const { fileUrl, eventId } = event;
        if (!fileUrl || !eventId) {
            return { statusCode: 400, body: "Missing fileUrl or eventId" };
        }
        await connectDB();
        const eventDoc = await Event.findById(eventId);
        if (!eventDoc) {
            return { statusCode: 404, body: "Event not found" };
        }
        /* ------------------------------ */
        /* ✅ PREPARE IV ATTACHMENT */
        /* ------------------------------ */
        let compressedIVUrl = "";
        if (eventDoc.iv) {
            try {
                compressedIVUrl = await prepareIVAttachment(eventId, eventDoc.name, eventDoc.iv);
                console.log("✅ Compressed IV URL ready:", compressedIVUrl);
            }
            catch (ivError) {
                console.error("❌ IV preparation failed, using original:", ivError);
                compressedIVUrl = eventDoc.iv;
            }
        }
        /* ------------------------------ */
        /* ✅ 1. PARSE CSV / EXCEL */
        /* ------------------------------ */
        const guests = await parseCsvExcel(fileUrl);
        if (!guests.length) {
            return { statusCode: 400, body: "No guests found in file" };
        }
        /* ------------------------------ */
        /* ✅ 2. PROCESS IN BATCHES */
        /* ------------------------------ */
        const BATCH_SIZE = 25;
        const results = [];
        for (let i = 0; i < guests.length; i += BATCH_SIZE) {
            const batch = guests.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(batch.map(async (guestData) => {
                try {
                    // Skip empty rows
                    if (!guestData.fullname || !guestData.fullname.trim()) {
                        return { ...guestData, success: false, error: "Empty fullname - row skipped", skipped: true };
                    }
                    const guest = await Guest.create({
                        ...guestData,
                        eventId,
                    });
                    const fullnameSafe = guest.fullname.replace(/[^a-zA-Z0-9-_]/g, "_");
                    /* ------------------------------ */
                    /* ✅ 3. GENERATE SVG TO S3 */
                    /* ------------------------------ */
                    const qrResult = await safeInvoke(QR_LAMBDA_FUNCTION_NAME, {
                        guestId: guest._id.toString(),
                        fullname: guest.fullname,
                        qrCodeBgColor: guest.qrCodeBgColor,
                        qrCodeCenterColor: guest.qrCodeCenterColor,
                        qrCodeEdgeColor: guest.qrCodeEdgeColor,
                        eventId,
                        TableNo: guest.TableNo,
                        others: guest.others,
                    });
                    const qrCodeUrl = qrResult?.qrCodeUrl;
                    /* ------------------------------ */
                    /* ✅ 4. CONVERT SVG → PNG */
                    /* ------------------------------ */
                    const pngResult = await safeInvoke(PNG_CONVERT_LAMBDA, {
                        guestId: guest._id.toString(),
                        eventId,
                        filename: fullnameSafe, // ✅ NAME USED FOR DOWNLOAD
                    });
                    const pngUrl = pngResult?.pngUrl;
                    /* ------------------------------ */
                    /* ✅ 5. UPDATE GUEST WITH QR DATA */
                    /* ------------------------------ */
                    await Guest.findByIdAndUpdate(guest._id, {
                        qrCode: qrCodeUrl,
                        qrCodeData: guest._id.toString(),
                    });
                    /* ------------------------------ */
                    /* ✅ 6. SEND EMAIL TO GUEST */
                    /* ------------------------------ */
                    const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id.toString()}`;
                    const attachments = await prepareEmailAttachments(compressedIVUrl, eventDoc.name);
                    await safeInvoke(EMAIL_LAMBDA_FUNCTION_NAME, {
                        to: guest.email,
                        from: `SoftInvites <info@softinvite.com>`,
                        subject: `You're Invited to ${eventDoc.name}`,
                        htmlContent: buildInvitationEmail({
                            fullname: guest.fullname,
                            message: guest.message || "You're invited!",
                            eventName: eventDoc.name,
                            eventDate: eventDoc.date || "",
                            qrCodeCenterColor: guest.qrCodeCenterColor,
                            finalQrUrl: downloadUrl,
                            downloadUrl: downloadUrl,
                        }),
                        attachments: attachments
                    });
                    return { guestId: guest._id, success: true, fullname: guest.fullname, email: guest.email };
                }
                catch (err) {
                    console.error("❌ Guest processing error:", guestData, err);
                    return {
                        ...guestData,
                        success: false,
                        error: err.message || String(err),
                        email: guestData.email || null
                    };
                }
            }));
            results.push(...batchResults);
        }
        /* ------------------------------ */
        /* ✅ PROCESS RESULTS & SEND ADMIN EMAIL */
        /* ------------------------------ */
        const fulfilled = results.filter(r => r.status === "fulfilled").map((r) => r.value);
        const successCount = fulfilled.filter((g) => g.success).length;
        const failedCount = fulfilled.filter((g) => !g.success).length;
        const failed = fulfilled.filter((g) => !g.success);
        console.log(`📊 Import Summary: ${successCount} successful, ${failedCount} failed`);
        console.log(`📧 Sending admin summary email to: ${ADMIN_EMAIL}`);
        const adminEmailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f7f8fc;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          <h2 style="color: #2d3748; border-bottom: 3px solid #4a5568; padding-bottom: 10px;">Guest Import Completed Successfully</h2>
          
          <div style="background: #f8faff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #4a5568; margin-top: 0;">Event Details</h3>
            <p><strong>Event Name:</strong> ${eventDoc.name}</p>
            <p><strong>Event Date:</strong> ${eventDoc.date || 'Not specified'}</p>
            <p><strong>Processed At:</strong> ${new Date().toLocaleString()}</p>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
            <div style="background: #48bb78; color: white; padding: 15px; border-radius: 8px; text-align: center;">
              <h3 style="margin: 0 0 10px 0; font-size: 14px;">Total Guests</h3>
              <p style="font-size: 32px; font-weight: bold; margin: 0;">${fulfilled.length}</p>
            </div>
            
            <div style="background: #4299e1; color: white; padding: 15px; border-radius: 8px; text-align: center;">
              <h3 style="margin: 0 0 10px 0; font-size: 14px;">Successful</h3>
              <p style="font-size: 32px; font-weight: bold; margin: 0;">${successCount}</p>
            </div>
            
            <div style="background: #e53e3e; color: white; padding: 15px; border-radius: 8px; text-align: center;">
              <h3 style="margin: 0 0 10px 0; font-size: 14px;">Failed</h3>
              <p style="font-size: 32px; font-weight: bold; margin: 0;">${failedCount}</p>
            </div>
            
            <div style="background: #805ad5; color: white; padding: 15px; border-radius: 8px; text-align: center;">
              <h3 style="margin: 0 0 10px 0; font-size: 14px;">Emails Sent</h3>
              <p style="font-size: 32px; font-weight: bold; margin: 0;">${successCount}</p>
            </div>
          </div>
          
          ${failedCount > 0 ? `
            <div style="margin-bottom: 20px;">
              <h3 style="color: #e53e3e; margin-bottom: 15px;">❌ Failed Guests (${failedCount})</h3>
              <div style="max-height: 300px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                  <thead style="background: #f7f8fc; position: sticky; top: 0;">
                    <tr>
                      <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Full Name</th>
                      <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Email</th>
                      <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${failed.slice(0, 50).map(guest => `
                      <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.fullname || 'N/A'}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.email || 'N/A'}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #e53e3e;">${guest.error || 'Unknown error'}</td>
                      </tr>
                    `).join('')}
                    ${failed.length > 50 ? `
                      <tr>
                        <td colspan="3" style="padding: 8px; text-align: center; color: #718096;">
                          ... and ${failed.length - 50} more failed records
                        </td>
                      </tr>
                    ` : ''}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #718096; font-size: 12px;">
            <p>Import completed by SoftInvites System</p>
          </div>
        </div>
      </div>
    `;
        const adminAttachments = await prepareEmailAttachments(compressedIVUrl, eventDoc.name);
        await safeInvoke(EMAIL_LAMBDA_FUNCTION_NAME, {
            to: ADMIN_EMAIL,
            from: `SoftInvites System <info@softinvite.com>`,
            subject: `Guest Import Complete: ${eventDoc.name}`,
            htmlContent: adminEmailHtml,
            attachments: adminAttachments
        });
        console.log("✅ Import Completed Successfully");
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Guests imported, QR generated, PNG converted & emails sent",
                total: guests.length,
                successful: successCount,
                failed: failedCount,
            }),
        };
    }
    catch (err) {
        console.error("❌ Import Failed:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Import failed",
                error: err.message,
            }),
        };
    }
};
