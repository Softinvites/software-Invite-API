import { parseCsvExcel } from "./parseCsvExcel.js";
import { handler as generateQrToS3 } from "./generateQrToS3.js";
import { rgbToHex } from "./colorUtils.js";
import { invokeLambda } from "./lambdaUtils.js";
import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { S3Client, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import sanitizeHtml from "sanitize-html";
const s3 = new S3Client({ region: process.env.AWS_REGION });
function parseS3Url(fileUrl) {
    const url = new URL(fileUrl);
    const bucket = url.hostname.split(".")[0];
    const key = decodeURIComponent(url.pathname.slice(1));
    return { bucket, key };
}
// Helper function to extract S3 key from S3 URL
function s3UrlToKey(s3Url) {
    try {
        const url = new URL(s3Url);
        // Remove bucket name from path and decode
        const key = decodeURIComponent(url.pathname.slice(1));
        return key;
    }
    catch (error) {
        console.error("❌ Failed to parse S3 URL:", s3Url, error);
        throw error;
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
// Function to prepare email attachments with S3 keys
async function prepareEmailAttachments(compressedIVUrl, eventName) {
    try {
        if (!compressedIVUrl)
            return [];
        // Check if it's an S3 URL
        if (!compressedIVUrl.includes('.s3.')) {
            console.warn('⚠️ Attachment URL is not an S3 URL:', compressedIVUrl);
            return [];
        }
        // Extract S3 key from URL
        const s3Key = s3UrlToKey(compressedIVUrl);
        console.log(`📎 Prepared attachment with S3 key: ${s3Key}`);
        return [{
                filename: `${eventName.replace(/[^a-zA-Z0-9]/g, '_')}_invitation.jpg`,
                s3Key: s3Key,
                contentType: 'image/jpeg'
            }];
    }
    catch (error) {
        console.error("❌ Failed to prepare email attachments:", error);
        return [];
    }
}
// Function to compress and upload IV to S3 once
async function prepareIVAttachment(eventId, eventName, originalIVUrl) {
    try {
        console.log("🖼️ Processing IV for event:", eventId);
        // Check if compressed version already exists
        const compressedKey = `events/${eventId}/compressed-invitation.jpg`;
        try {
            // Try to get existing compressed IV
            const existingUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${compressedKey}`;
            // Quick check if accessible
            const testResponse = await fetch(existingUrl, { method: 'HEAD' });
            if (testResponse.ok) {
                console.log("✅ Using existing compressed IV");
                return existingUrl;
            }
        }
        catch {
            // Proceed to create new compressed version
        }
        // Download and compress original IV
        console.log("📥 Downloading original IV:", originalIVUrl);
        const response = await fetch(originalIVUrl);
        if (!response.ok) {
            throw new Error(`Failed to download IV: ${response.statusText}`);
        }
        const originalBuffer = Buffer.from(await response.arrayBuffer());
        console.log(`📄 Original IV size: ${(originalBuffer.length / 1024).toFixed(1)}KB`);
        // Compress image using Sharp - optimized for email
        const compressedBuffer = await sharp(originalBuffer)
            .resize(600, 400, {
            fit: 'inside',
            withoutEnlargement: true,
            background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
        })
            .jpeg({
            quality: 70,
            progressive: true,
            mozjpeg: true // Better compression
        })
            .toBuffer();
        console.log(`⚙️ Compressed IV size: ${(compressedBuffer.length / 1024).toFixed(1)}KB`);
        // Upload compressed IV to S3
        const putObjectCommand = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: compressedKey,
            Body: compressedBuffer,
            ContentType: "image/jpeg",
            CacheControl: "max-age=31536000",
            Metadata: {
                "event-id": eventId,
                "compressed": "true",
                "original-size": originalBuffer.length.toString(),
                "compressed-size": compressedBuffer.length.toString()
            }
        });
        await s3.send(putObjectCommand);
        const compressedUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${compressedKey}`;
        console.log("✅ Compressed IV uploaded:", compressedUrl);
        return compressedUrl;
    }
    catch (error) {
        console.error("❌ Failed to prepare IV attachment:", error);
        // Return original URL as fallback
        return originalIVUrl;
    }
}
// Function to convert SVG QR code to PNG and upload to S3
async function convertQrToPngAndUpload(svgUrl, guestId, eventId) {
    try {
        console.log("🔄 Converting QR code to PNG for guest:", guestId);
        // Check if PNG already exists
        const pngKey = `qr_codes/png/${eventId}/${guestId}.png`;
        const existingUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${pngKey}`;
        try {
            const testResponse = await fetch(existingUrl, { method: 'HEAD' });
            if (testResponse.ok) {
                console.log("✅ Using existing PNG QR code");
                return existingUrl;
            }
        }
        catch {
            // Proceed to create new PNG
        }
        // Download the SVG
        const response = await fetch(svgUrl);
        if (!response.ok) {
            throw new Error(`Failed to download SVG: ${response.statusText}`);
        }
        const svgText = await response.text();
        // Convert SVG to PNG
        const pngBuffer = await sharp(Buffer.from(svgText))
            .resize(300, 300) // Reduced size for email
            .png({
            compressionLevel: 9,
            palette: true // Use palette for smaller files
        })
            .toBuffer();
        // Upload PNG to S3
        const putObjectCommand = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: pngKey,
            Body: pngBuffer,
            ContentType: "image/png",
            CacheControl: "max-age=31536000"
        });
        await s3.send(putObjectCommand);
        console.log("✅ QR code converted to PNG:", existingUrl);
        return existingUrl;
    }
    catch (error) {
        console.error("❌ Failed to convert QR to PNG:", error);
        return svgUrl;
    }
}
// Function to create email content (without sending)
function createEmailContent(guest, eventDetails, qrCodeUrl, compressedIVUrl) {
    const sanitizedMessage = guest.message ? sanitizeHtml(guest.message, {
        allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br"],
        allowedAttributes: {},
    }) : "You are cordially invited to our special event. We look forward to celebrating with you.";
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor || "0,0,0");
    const darkerCenterColor = adjustColorBrightness(centerColorHex, -20);
    const num = parseInt(centerColorHex.replace("#", ""), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const textColor = brightness > 180 ? "#000000" : "#ffffff";
    const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id || guest.guestId}`;
    return `
    <div style="font-family: 'Segoe UI', 'Arial', sans-serif; background: #f7f8fc; padding: 20px 10px; margin: 0; line-height: 1.6;">
      <div style="width: 100%; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
        
        <!-- Header Section -->
        <div style="background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); padding: 40px 20px; text-align: center;">
          <h1 style="color: ${textColor}; font-size: clamp(24px, 5vw, 32px); font-weight: 600; margin: 0 0 8px 0; letter-spacing: 0.5px;">${eventDetails.name}</h1>
          <p style="color: ${textColor}; font-size: clamp(14px, 3vw, 18px); margin: 0; opacity: 0.9;">${eventDetails.date}</p>
        </div>

        <!-- Main Content -->
        <div style="padding: 30px 20px;">
          
          <!-- Personal Greeting -->
          <div style="margin-bottom: 30px;">
            <div style="background: #f8faff; padding: 20px; border-radius: 8px;">
              <p style="font-size: clamp(16px, 4vw, 18px); margin: 0 0 12px 0; font-weight: 600; color: ${darkerCenterColor};">Dear ${guest.fullname},</p>
              <div style="font-size: clamp(14px, 3.5vw, 16px); color: #4a5568; line-height: 1.7;">
                ${sanitizedMessage}
              </div>
            </div>
          </div>

          <!-- QR Code Section -->
          <div style="text-align: center; background: linear-gradient(135deg, #f8faff 0%, #e8f2ff 100%); padding: 30px 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
            <h2 style="color: ${centerColorHex}; font-size: clamp(18px, 4vw, 22px); font-weight: 600; margin: 0 0 25px 0;">🎟️ Your Digital Pass</h2>
            
            <div style="background: #ffffff; padding: clamp(30px, 6vw, 50px); border-radius: 12px; display: inline-block; box-shadow: 0 4px 16px rgba(30,60,114,0.1); border: 1px solid #e2e8f0;">
              <img src="${downloadUrl}" 
                   alt="Your Event QR Code" 
                   width="300" height="300"
                   style="display: block; border-radius: 8px; max-width: 100%; height: auto;" />
            </div>
            
            <p style="color: #718096; font-size: clamp(12px, 3vw, 14px); margin: 20px 0 25px 0;">Present this code at the event entrance for quick check-in</p>
            
            <a href="${downloadUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); color: ${textColor}; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: clamp(12px, 3vw, 14px); box-shadow: 0 4px 12px rgba(30,60,114,0.3); transition: all 0.3s ease;">
               Download QR Code
            </a>
          </div>

          <!-- Important Notice -->
          <div style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: #ffffff; padding: 20px; border-radius: 10px; margin: 30px 0 0 0; text-align: center;">
            <p style="font-size: 15px; font-weight: 600; margin: 0 0 5px 0;">Invitation Confirmed</p>
            <p style="font-size: 13px; margin: 0; opacity: 0.9;">This invitation is exclusively for you. Please keep your QR code secure.</p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #f7f8fc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 12px; color: #718096; margin: 0;">© 2025 <strong style="color: #4a5568;">SoftInvites</strong> • All rights reserved</p>
        </div>
      </div>
    </div>
  `;
}
export const handler = async (event) => {
    const userEmail = "softinvites@gmail.com";
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
        // Prepare compressed IV URL (once for all guests)
        let compressedIVUrl = "";
        if (eventDetails.iv) {
            try {
                compressedIVUrl = await prepareIVAttachment(eventId, eventDetails.name, eventDetails.iv);
                console.log("✅ Compressed IV URL ready:", compressedIVUrl);
            }
            catch (ivError) {
                console.error("❌ IV preparation failed, using original:", ivError);
                compressedIVUrl = eventDetails.iv;
            }
        }
        // 1. Parse guests from CSV
        const guests = await parseCsvExcel(fileUrl);
        console.log("📂 Parsed guests:", guests.length, "Sample:", guests.slice(0, 2));
        // Filter out completely empty guests
        const validGuests = guests.filter(guest => guest.fullname && guest.fullname.trim());
        console.log(`📋 Valid guests after filtering: ${validGuests.length} out of ${guests.length}`);
        if (!Array.isArray(guests) || guests.length === 0 || validGuests.length === 0) {
            // Send failure email to admin
            const failureAttachments = await prepareEmailAttachments(compressedIVUrl, eventDetails.name);
            await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
                to: userEmail,
                subject: "Guest Import Failed",
                htmlContent: `<p>No valid guests found in file. Parsed ${guests.length} rows, but ${validGuests.length} had valid names.</p>`,
                from: "SoftInvites System <info@softinvite.com>",
                attachments: failureAttachments
            }, true);
            return { statusCode: 400, body: JSON.stringify({ message: "No valid guests found" }) };
        }
        const guestsToProcess = validGuests;
        // 2. Process guests in optimized batches
        const results = [];
        const emailPromises = [];
        const batchSize = 10; // Increased batch size for efficiency
        for (let i = 0; i < guestsToProcess.length; i += batchSize) {
            const batch = guestsToProcess.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch.map(async (guest) => {
                try {
                    // Skip empty rows
                    if (!guest.fullname || !guest.fullname.trim()) {
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
                    const qrData = JSON.parse(qrResponse.body || "{}");
                    if (!qrData.qrCodeUrl)
                        throw new Error("QR generation failed: no URL");
                    savedGuest.qrCode = qrData.qrCodeUrl;
                    savedGuest.qrCodeData = savedGuest._id.toString();
                    await savedGuest.save();
                    // Prepare email data (don't send yet)
                    if (guest.email && guest.email.trim()) {
                        // Convert QR to PNG for email compatibility
                        let qrCodeUrlForEmail = qrData.qrCodeUrl;
                        try {
                            qrCodeUrlForEmail = await convertQrToPngAndUpload(qrData.qrCodeUrl, savedGuest._id.toString(), eventId);
                        }
                        catch (conversionError) {
                            console.warn("⚠️ Using SVG QR code as fallback for guest:", guest.email, conversionError);
                        }
                        // Create email content
                        const emailContent = createEmailContent({ ...guest, _id: savedGuest._id }, eventDetails, qrCodeUrlForEmail, compressedIVUrl);
                        // Prepare attachments with S3 keys
                        const attachments = await prepareEmailAttachments(compressedIVUrl, eventDetails.name);
                        // Queue email sending (non-blocking)
                        emailPromises.push(invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
                            to: guest.email,
                            subject: `Invitation to ${eventDetails.name}`,
                            htmlContent: emailContent,
                            from: `${eventDetails.name} <info@softinvite.com>`,
                            attachments: attachments
                        }, true).catch(emailError => {
                            console.error(`❌ Email failed for ${guest.email}:`, emailError);
                            return { success: false, email: guest.email, error: emailError.message };
                        }));
                    }
                    return {
                        ...savedGuest.toObject(),
                        success: true,
                        email: guest.email || null
                    };
                }
                catch (err) {
                    console.error("❌ Guest processing error:", guest, err);
                    return {
                        ...guest,
                        success: false,
                        error: err.message || String(err),
                        email: guest.email || null
                    };
                }
            }));
            results.push(...batchResults);
            // Log progress every 100 guests
            if (i % 100 === 0) {
                console.log(`📊 Progress: Processed ${Math.min(i + batchSize, guestsToProcess.length)}/${guestsToProcess.length} guests`);
            }
        }
        // Wait for all emails to be queued
        console.log(`📧 Waiting for ${emailPromises.length} email send operations...`);
        const emailResults = await Promise.allSettled(emailPromises);
        // Count email successes/failures
        const emailSuccesses = emailResults.filter(r => r.status === 'fulfilled' && r.value && r.value.success !== false).length;
        const emailFailures = emailResults.length - emailSuccesses;
        // 3. Process results
        const fulfilled = results.filter(r => r.status === "fulfilled").map((r) => r.value);
        const successCount = fulfilled.filter((g) => g.success).length;
        const failedCount = fulfilled.filter((g) => !g.success).length;
        const failed = fulfilled.filter((g) => !g.success);
        // 4. Send completion summary to admin (WITH IV ATTACHMENT)
        console.log(`📊 Import Summary: ${successCount} successful, ${failedCount} failed`);
        console.log(`📧 Email Summary: ${emailSuccesses} sent, ${emailFailures} failed`);
        console.log(`📧 Sending admin email to: ${userEmail}`);
        try {
            const adminEmailHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f7f8fc;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <h2 style="color: #2d3748; border-bottom: 3px solid #4a5568; padding-bottom: 10px;">Guest Import Completed Successfully</h2>
            
            <div style="background: #f8faff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #4a5568; margin-top: 0;">Event Details</h3>
              <p><strong>Event Name:</strong> ${eventDetails.name}</p>
              <p><strong>Event Date:</strong> ${eventDetails.date}</p>
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
                <p style="font-size: 32px; font-weight: bold; margin: 0;">${emailSuccesses}</p>
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
              <p>Import completed by Soft Invites System</p>
            </div>
          </div>
        </div>
      `;
            // Prepare attachments for admin email
            const adminAttachments = await prepareEmailAttachments(compressedIVUrl, eventDetails.name);
            // Send admin email WITH IV ATTACHMENT
            await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
                to: userEmail,
                subject: `Guest Import Complete: ${eventDetails.name}`,
                htmlContent: adminEmailHtml,
                from: `Soft Invites System <info@softinvite.com>`,
                attachments: adminAttachments
            }, true);
            console.log(`✅ Admin email sent successfully to ${userEmail}`);
        }
        catch (emailError) {
            console.error(`❌ Failed to send admin email:`, emailError);
        }
        // 5. Cleanup CSV
        try {
            await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
            console.log(`✅ Cleaned up CSV: ${bucket}/${key}`);
        }
        catch (cleanupErr) {
            console.warn("⚠️ Failed to delete CSV:", cleanupErr);
        }
        return {
            statusCode: 200,
            body: JSON.stringify({
                guests: fulfilled,
                totalProcessed: results.length,
                successful: successCount,
                failed: failedCount,
                emailsSent: emailSuccesses,
                emailsFailed: emailFailures,
                eventName: eventDetails.name,
                failedGuests: failed.slice(0, 100),
                compressedIVUrl: compressedIVUrl || null
            }),
        };
    }
    catch (error) {
        console.error("❌ Import Lambda error:", error);
        // Send failure email to admin
        await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            to: userEmail,
            subject: "Guest Import Failed",
            htmlContent: `
        <h3>Guest Import Failed</h3>
        <p><strong>Event ID:</strong> ${eventId}</p>
        <p><strong>Error:</strong> ${error.message}</p>
        <p>Please check the file format and try again.</p>
      `,
            from: "Soft Invites System <info@softinvite.com>"
        }, true);
        // Attempt cleanup even on failure
        try {
            const { bucket, key } = parseS3Url(fileUrl);
            await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
            console.log(`✅ Cleaned up CSV after failure: ${bucket}/${key}`);
        }
        catch (cleanupErr) {
            console.warn("⚠️ Failed to delete CSV after failure:", cleanupErr);
        }
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Error importing guests",
                error: error.message
            }),
        };
    }
};
