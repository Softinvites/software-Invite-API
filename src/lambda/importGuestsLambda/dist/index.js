import { parseCsvExcel } from "./parseCsvExcel.js";
import { handler as generateQrToS3 } from "./generateQrToS3.js";
import { rgbToHex } from "./colorUtils.js";
import { invokeLambda } from "./lambdaUtils.js";
import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sanitizeHtml from "sanitize-html";
const s3 = new S3Client({ region: process.env.AWS_REGION });
function parseS3Url(fileUrl) {
    const url = new URL(fileUrl);
    const bucket = url.hostname.split(".")[0];
    const key = decodeURIComponent(url.pathname.slice(1));
    return { bucket, key };
}
// Function to get event details by eventId
async function getEventDetails(eventId) {
    try {
        const event = await Event.findById(eventId);
        if (!event) {
            console.warn(`Event not found for ID: ${eventId}`);
            return { name: "Our Event", date: "", iv: "" };
        }
        return {
            name: event.name,
            date: event.date,
            iv: event.iv || ""
        };
    }
    catch (error) {
        console.error("Error fetching event details:", error);
        return { name: "Our Event", date: "", iv: "" };
    }
}
// Helper function to adjust color brightness
const adjustColorBrightness = (hex, percent) => {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
};
export const handler = async (event) => {
    const userEmail = event.userEmail || "softinvites@gmail.com";
    const { fileUrl, eventId } = event;
    if (!fileUrl || !eventId) {
        return { statusCode: 400, body: JSON.stringify({ message: "Missing fileUrl or eventId" }) };
    }
    const { bucket, key } = parseS3Url(fileUrl);
    try {
        await connectDB();
        // Get event details for email template
        const eventDetails = await getEventDetails(eventId);
        console.log("📅 Event details:", eventDetails);
        // 1. Parse guests from CSV
        const guests = await parseCsvExcel(fileUrl);
        console.log("📂 Parsed guests:", guests.length, "Sample:", guests.slice(0, 2));
        if (!Array.isArray(guests) || guests.length === 0) {
            await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
                to: userEmail,
                subject: "Guest Import Failed",
                htmlContent: "<p>No valid guests found in file.</p>",
            }, true);
            return { statusCode: 400, body: JSON.stringify({ message: "No valid guests found" }) };
        }
        // 2. Process guests in batches
        const results = [];
        const batchSize = 3;
        for (let i = 0; i < guests.length; i += batchSize) {
            const batch = guests.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch.map(async (guest) => {
                try {
                    // Skip empty rows
                    if (!guest.fullname || !guest.fullname.trim()) {
                        console.log(`⏭️ Skipping empty row`);
                        return { ...guest, success: false, error: "Empty fullname - row skipped", skipped: true };
                    }
                    // Save guest
                    const newGuest = new Guest({
                        fullname: guest.fullname,
                        TableNo: guest.TableNo,
                        email: guest.email,
                        phone: guest.phone,
                        message: guest.message,
                        others: guest.others,
                        qrCodeBgColor: guest.qrCodeBgColor,
                        qrCodeCenterColor: guest.qrCodeCenterColor,
                        qrCodeEdgeColor: guest.qrCodeEdgeColor,
                        eventId,
                        status: "pending",
                        imported: true,
                        checkedIn: false,
                    });
                    const savedGuest = await newGuest.save();
                    // Generate QR
                    const qrResponse = await generateQrToS3({
                        guestId: savedGuest._id.toString(),
                        fullname: guest.fullname,
                        qrCodeBgColor: rgbToHex(guest.qrCodeBgColor),
                        qrCodeCenterColor: rgbToHex(guest.qrCodeCenterColor),
                        qrCodeEdgeColor: rgbToHex(guest.qrCodeEdgeColor),
                        eventId,
                        TableNo: guest.TableNo,
                        others: guest.others,
                    });
                    console.log("🌀 Raw QR Response:", qrResponse);
                    const qrData = JSON.parse(qrResponse.body || "{}");
                    if (!qrData.qrCodeUrl)
                        throw new Error("QR generation failed: no URL");
                    savedGuest.qrCode = qrData.qrCodeUrl;
                    savedGuest.qrCodeData = savedGuest._id.toString();
                    await savedGuest.save();
                    // Send guest email with enhanced template
                    if (guest.email) {
                        const sanitizedMessage = guest.message ? sanitizeHtml(guest.message, {
                            allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br"],
                            allowedAttributes: {},
                        }) : "You are cordially invited to our special event. We look forward to celebrating with you.";
                        // Convert SVG to PNG for email compatibility using pngConvertLambda
                        let pngQrCodeUrl = "";
                        if (qrData.qrCodeUrl) {
                            try {
                                const lambdaResponse = await invokeLambda(process.env.PNG_CONVERT_LAMBDA, {
                                    guestId: savedGuest._id.toString(),
                                    eventId: eventId
                                });
                                const parsedBody = typeof lambdaResponse.body === 'string'
                                    ? JSON.parse(lambdaResponse.body)
                                    : lambdaResponse.body;
                                pngQrCodeUrl = parsedBody?.pngUrl || "";
                            }
                            catch (pngError) {
                                console.error("❌ PNG conversion failed:", pngError);
                            }
                        }
                        const finalQrUrl = pngQrCodeUrl || qrData.qrCodeUrl;
                        const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${savedGuest._id.toString()}`;
                        // Get QR center color for header and determine text color
                        const centerColorHex = rgbToHex(guest.qrCodeCenterColor || "0,0,0");
                        const darkerCenterColor = adjustColorBrightness(centerColorHex, -20);
                        // Simple text color logic: white for dark colors, black for light colors
                        const num = parseInt(centerColorHex.replace("#", ""), 16);
                        const r = (num >> 16) & 255;
                        const g = (num >> 8) & 255;
                        const b = num & 255;
                        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                        const textColor = brightness > 180 ? "#000000" : "#ffffff";
                        const emailContent = `
                <div style="font-family: 'Segoe UI', 'Arial', sans-serif; background: #f7f8fc; padding: 20px 10px; margin: 0; line-height: 1.6;">
                  <div style="width: 100%; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
                    <div style="background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); padding: 40px 20px; text-align: center;">
                      <h1 style="color: ${textColor}; font-size: clamp(24px, 5vw, 32px); font-weight: 600; margin: 0 0 8px 0; letter-spacing: 0.5px;">${eventDetails.name}</h1>
                      <p style="color: ${textColor}; font-size: clamp(14px, 3vw, 18px); margin: 0; opacity: 0.9;">${eventDetails.date}</p>
                    </div>
                    <div style="padding: 30px 20px;">
                      <div style="margin-bottom: 30px;">
                        <div style="background: #f8faff; padding: 20px; border-radius: 8px;">
                          <p style="font-size: clamp(16px, 4vw, 18px); margin: 0 0 12px 0; font-weight: 600; color: ${darkerCenterColor};">Dear ${guest.fullname},</p>
                          <div style="font-size: clamp(14px, 3.5vw, 16px); color: #4a5568; line-height: 1.7;">
                            ${sanitizedMessage}
                          </div>
                        </div>
                      </div>
                      <div style="text-align: center; background: linear-gradient(135deg, #f8faff 0%, #e8f2ff 100%); padding: 30px 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <h2 style="color: ${centerColorHex}; font-size: clamp(18px, 4vw, 22px); font-weight: 600; margin: 0 0 25px 0;">🎟️ Your Digital Pass</h2>
                        <div style="background: #ffffff; padding: clamp(30px, 6vw, 50px); border-radius: 12px; display: inline-block; box-shadow: 0 4px 16px rgba(30,60,114,0.1); border: 1px solid #e2e8f0;">
                          ${finalQrUrl ? `<a href="${downloadUrl}"><img src="${finalQrUrl}" alt="Your Event QR Code" width="300" height="300" style="display: block; border-radius: 8px; max-width: 100%; height: auto; cursor: pointer;" /></a>` : `<div style="width: 300px; height: 300px; background: #f7f8fc; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 2px dashed #cbd5e0; max-width: 100%;"><p style="color: #718096; margin: 0; font-size: 14px; text-align: center;">Loading QR Code...</p></div>`}
                        </div>
                        <p style="color: #718096; font-size: clamp(12px, 3vw, 14px); margin: 20px 0 25px 0;">Present this code at the event entrance for quick check-in</p>
                        <a href="${downloadUrl}" style="display: inline-block; background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); color: ${textColor}; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: clamp(12px, 3vw, 14px); box-shadow: 0 4px 12px rgba(30,60,114,0.3); transition: all 0.3s ease;">📥 Download QR Code</a>
                      </div>
                      <div style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: #ffffff; padding: 20px; border-radius: 10px; margin: 30px 0 0 0; text-align: center;">
                        <p style="font-size: 15px; font-weight: 600; margin: 0 0 5px 0;">Invitation Confirmed</p>
                        <p style="font-size: 13px; margin: 0; opacity: 0.9;">This invitation is exclusively for you. Please keep your QR code secure.</p>
                      </div>
                    </div>
                    <div style="background: #f7f8fc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                      <p style="font-size: 12px; color: #718096; margin: 0;">© 2025 <strong style="color: #4a5568;">Soft Invites</strong> • All rights reserved</p>
                    </div>
                  </div>
                </div>
              `;
                        console.log(`📤 Sending email to: ${guest.email}`);
                        console.log(`📧 Email Lambda Function: ${process.env.EMAIL_LAMBDA_FUNCTION_NAME}`);
                        const emailPayload = {
                            to: guest.email,
                            from: `${eventDetails.name} <info@softinvite.com>`,
                            subject: `Invitation to ${eventDetails}`,
                            htmlContent: emailContent
                        };
                        if (eventDetails.iv) {
                            try {
                                const imageResponse = await fetch(eventDetails.iv);
                                if (imageResponse.ok) {
                                    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                                    emailPayload.attachments = [
                                        {
                                            filename: `${eventDetails.name.replace(/[^a-zA-Z0-9]/g, '_')}_invitation.jpg`,
                                            content: imageBuffer.toString('base64'),
                                            contentType: 'image/jpeg'
                                        }
                                    ];
                                    console.log("📧 Sending email with event IV attachment");
                                }
                            }
                            catch (attachmentError) {
                                console.error("❌ Failed to download event IV for attachment:", attachmentError);
                            }
                        }
                        console.log(`📧 Email payload:`, JSON.stringify(emailPayload, null, 2));
                        try {
                            const emailResponse = await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, emailPayload, true);
                            console.log(`📧 Email Lambda response:`, emailResponse);
                            console.log(`✅ Email sent to ${guest.email}`);
                        }
                        catch (emailError) {
                            console.error(`❌ Email sending failed for ${guest.email}:`, emailError);
                            throw emailError;
                        }
                    }
                    return { ...savedGuest.toObject(), success: true };
                }
                catch (err) {
                    console.error("❌ Guest processing error:", guest, err);
                    return { ...guest, success: false, error: err.message || String(err) };
                }
            }));
            results.push(...batchResults);
        }
        // 3. Summaries
        const fulfilled = results.filter(r => r.status === "fulfilled").map((r) => r.value);
        const successCount = fulfilled.filter((g) => g.success).length;
        const failedCount = fulfilled.filter((g) => !g.success).length;
        const failed = fulfilled.filter((g) => !g.success);
        // 4. Send completion summary to admin
        console.log(`📊 Import Summary: ${successCount} successful, ${failedCount} failed`);
        await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            to: userEmail,
            subject: "Guest Import Completed",
            htmlContent: `
        <h3>Guest Import Completed</h3>
        <p>Event: <strong>${eventDetails.name}</strong></p>
        <p>Total Guests Processed: ${results.length}</p>
        <p>Successful: ${successCount}</p>
        <p>Failed: ${failedCount}</p>
        
        ${failedCount > 0 ? `
          <h4>Failed Guests:</h4>
          <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
            <thead style="background-color: #f2f2f2;">
              <tr>
                <th>Full Name</th>
                <th>Table No</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Others</th>
              </tr>
            </thead>
            <tbody>
              ${failed.map(guest => `
                <tr>
                  <td>${guest.fullname || 'N/A'}</td>
                  <td>${guest.TableNo || 'N/A'}</td>
                  <td>${guest.email || 'N/A'}</td>
                  <td>${guest.phone || 'N/A'}</td>
                  <td>${guest.others || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p style="color: #d63031; margin-top: 10px;">Check the logs for details on failed imports.</p>
        ` : ''}
      `,
        }, true);
        // 5. ✅ Cleanup CSV
        try {
            await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
            console.log(`Cleaned up CSV: ${bucket}/${key}`);
        }
        catch (cleanupErr) {
            console.warn("Failed to delete CSV:", cleanupErr);
        }
        return {
            statusCode: 200,
            body: JSON.stringify({
                guests: fulfilled,
                totalProcessed: results.length,
                successful: successCount,
                failed: failedCount,
                eventName: eventDetails.name,
                FailedGuests: failed,
            }),
        };
    }
    catch (error) {
        console.error("❌ Import Lambda error:", error);
        await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            to: userEmail,
            subject: "Guest Import Failed",
            htmlContent: `
        <h3>Guest Import Failed</h3>
        <p>Event ID: ${eventId}</p>
        <p>Error: ${error.message}</p>
        <p>Please check the file format and try again.</p>
      `,
        }, true);
        // attempt cleanup even on failure
        try {
            const { bucket, key } = parseS3Url(fileUrl);
            await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
            console.log(`Cleaned up CSV after failure: ${bucket}/${key}`);
        }
        catch (cleanupErr) {
            console.warn("Failed to delete CSV after failure:", cleanupErr);
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error importing guests", error: error.message }),
        };
    }
};
