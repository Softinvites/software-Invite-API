// import { v4 as uuidv4 } from "uuid";
// import { parseCsvExcel } from "./parseCsvExcel.js";
// import { handler as generateQrToS3 } from "./generateQrToS3.js";
// import { rgbToHex } from "./colorUtils.js";
// import { invokeLambda } from "./lambdaUtils.js";
// import { connectDB } from "./db.js";
// import { Guest } from "./guestmodel.js";
// import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
// const s3 = new S3Client({ region: process.env.AWS_REGION });
// function parseS3Url(fileUrl: string) {
//   const url = new URL(fileUrl);
//   const bucket = url.hostname.split(".")[0]; // e.g. "mybucket" from "mybucket.s3.amazonaws.com"
//   const key = decodeURIComponent(url.pathname.slice(1)); // remove leading "/"
//   return { bucket, key };
// }
// export const handler = async (event: any) => {
//   const userEmail = event.userEmail || "softinvites@gmail.com";
//   const { fileUrl, eventId } = event;
//   if (!fileUrl || !eventId) {
//     return { statusCode: 400, body: JSON.stringify({ message: "Missing fileUrl or eventId" }) };
//   }
//   const { bucket, key } = parseS3Url(fileUrl);
//   try {
//     await connectDB();
//     // 1. Parse guests from CSV
//     const guests = await parseCsvExcel(fileUrl);
//     console.log("📂 Parsed guests:", guests.length, "Sample:", guests.slice(0, 2));
//     if (!Array.isArray(guests) || guests.length === 0) {
//       await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME!, {
//         to: userEmail,
//         subject: "Guest Import Failed",
//         htmlContent: "<p>No valid guests found in file.</p>",
//       }, true);
//       return { statusCode: 400, body: JSON.stringify({ message: "No valid guests found" }) };
//     }
//     // 2. Process guests in batches
//     const results: any[] = [];
//     const batchSize = 10;
//     for (let i = 0; i < guests.length; i += batchSize) {
//       const batch = guests.slice(i, i + batchSize);
//       const batchResults = await Promise.allSettled(
//         batch.map(async (guest) => {
//           try {
//             // Save guest
//             const newGuest = new Guest({
//               fullname: guest.fullname,
//               TableNo: guest.TableNo,
//               email: guest.email,
//               phone: guest.phone,
//               message: guest.message,
//               others: guest.others,
//               qrCodeBgColor: guest.qrCodeBgColor,
//               qrCodeCenterColor: guest.qrCodeCenterColor,
//               qrCodeEdgeColor: guest.qrCodeEdgeColor,
//               eventId,
//               status: "pending",
//               imported: true,
//               checkedIn: false,
//             });
//             const savedGuest = await newGuest.save();
//             // Generate QR
//             const qrResponse = await generateQrToS3({
//               guestId: savedGuest._id.toString(),
//               fullname: guest.fullname,
//               qrCodeBgColor: rgbToHex(guest.qrCodeBgColor),
//               qrCodeCenterColor: rgbToHex(guest.qrCodeCenterColor),
//               qrCodeEdgeColor: rgbToHex(guest.qrCodeEdgeColor),
//               eventId,
//               TableNo: guest.TableNo,
//               others: guest.others,
//             });
//             console.log("🌀 Raw QR Response:", qrResponse);
//             const qrData = JSON.parse(qrResponse.body || "{}");
//             if (!qrData.qrCodeUrl) throw new Error("QR generation failed: no URL");
//             savedGuest.qrCode = qrData.qrCodeUrl;
//             savedGuest.qrCodeData = savedGuest._id.toString();
//             await savedGuest.save();
//             // Send guest email
//             if (guest.email) {
//               await invokeLambda(
//                 process.env.EMAIL_LAMBDA_FUNCTION_NAME!,
//                 {
//                   to: guest.email,
//                   subject: "Your Invitation",
//                   htmlContent: `<p>Hello ${guest.fullname}, here is your invitation QR:</p>
//                                 <p><img src="${qrData.qrCodeUrl}" /></p>`,
//                 },
//                 true
//               );
//             }
//             return { ...savedGuest.toObject(), success: true };
//           } catch (err: any) {
//             console.error("❌ Guest processing error:", guest, err);
//             return { ...guest, success: false, error: err.message || String(err) };
//           }
//         })
//       );
//       results.push(...batchResults);
//     }
//     // 3. Summaries
//     const fulfilled = results.filter(r => r.status === "fulfilled").map((r: any) => r.value);
//     const successCount = fulfilled.filter((g) => g.success).length;
//     const failedCount = fulfilled.filter((g) => !g.success).length;
//     // 4. Send completion summary to admin
//     await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME!, {
//       to: userEmail,
//       subject: "Guest Import Completed",
//       htmlContent: `
//         <h3>Guest Import Completed</h3>
//         <p>Total Guests Processed: ${results.length}</p>
//         <p>Successful: ${successCount}</p>
//         <p>Failed: ${failedCount}</p>
//       `,
//     }, true);
//     // 5. ✅ Cleanup CSV
//     try {
//       await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
//       console.log(`Cleaned up CSV: ${bucket}/${key}`);
//     } catch (cleanupErr) {
//       console.warn("Failed to delete CSV:", cleanupErr);
//     }
//     return {
//       statusCode: 200,
//       body: JSON.stringify({
//         guests: fulfilled,
//         totalProcessed: results.length,
//         successful: successCount,
//         failed: failedCount,
//       }),
//     };
//   } catch (error: any) {
//     console.error("❌ Import Lambda error:", error);
//     await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME!, {
//       to: userEmail,
//       subject: "Guest Import Failed",
//       htmlContent: `<p>${error.message}</p>`,
//     }, true);
//     // attempt cleanup even on failure
//     try {
//       const { bucket, key } = parseS3Url(fileUrl);
//       await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
//       console.log(`Cleaned up CSV after failure: ${bucket}/${key}`);
//     } catch (cleanupErr) {
//       console.warn("Failed to delete CSV after failure:", cleanupErr);
//     }
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ message: "Error importing guests", error: error.message }),
//     };
//   }
// };
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
            return { name: "Our Event", iv: "" };
        }
        return {
            name: event.name,
            iv: event.iv || ""
        };
    }
    catch (error) {
        console.error("Error fetching event details:", error);
        return { name: "Our Event", iv: "" };
    }
}
export const handler = async (event) => {
    const userEmail = event.userEmail || "softinvites@gmail.com";
    const { fileUrl, eventId } = event;
    if (!fileUrl || !eventId) {
        return { statusCode: 400, body: JSON.stringify({ message: "Missing fileUrl or eventId" }) };
    }
    const { bucket, key } = parseS3Url(fileUrl);
    try {
        await connectDB();
        // Get event details once for the import
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
        const batchSize = 10;
        for (let i = 0; i < guests.length; i += batchSize) {
            const batch = guests.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch.map(async (guest) => {
                try {
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
                        const emailContent = `
                <div style="font-family: 'Georgia', serif; color: #000; background-color: #fff; padding: 20px; max-width: 600px; margin: 0 auto;">
                  <!-- IMPORTANT WARNING BANNER -->
                  <div style="background: #fff5f5; border: 2px solid #ff6b6b; border-radius: 8px; padding: 15px; margin-bottom: 25px; text-align: center;">
                    <p style="color: #d63031; margin: 0; font-weight: bold; font-size: 14px;">
                      🔍 IMPORTANT: Enable images to view your QR code event pass
                    </p>
                    <p style="color: #666; margin: 5px 0 0 0; font-size: 12px;">
                      Most email providers block images by default for security
                    </p>
                  </div>
                  
                  <h2 style="text-align: center; font-weight: bold; font-size: 24px; margin-bottom: 10px; color: #7d0e2b;">${eventDetails.name}</h2>
                  <hr style="border: none; border-top: 2px solid #7d0e2b; margin: 10px auto; width: 80%;" />

                  ${eventDetails.iv ? `
                    <div style="text-align: center; margin: 30px 0;">
                      <img src="${eventDetails.iv}" alt="Event Invitation" width="400" style="border: 10px solid #7d0e2b; border-radius: 8px; max-width: 100%;" />
                    </div>
                  ` : ''}

                  <p style="font-size: 16px; line-height: 1.6;">Dear <strong style="color: #7d0e2b;">${guest.fullname}</strong>,</p>
                  <p style="font-weight: bold; font-size: 16px; line-height: 1.6; background: #fff5f5; padding: 15px; border-radius: 5px;">${sanitizedMessage}</p>

                  <p style="font-weight: bold; margin-top: 30px; font-size: 14px; color: #555;">
                    Please note: This event is strictly by invitation and this invitation is uniquely intended for you. 
                    A personalised QR code is provided below.
                  </p>
                  <p style="font-size: 14px; line-height: 1.6;">Kindly acknowledge receipt of this e-invitation. We look forward to welcoming you at the event.</p>
                  <p style="font-style: italic; color: #666; text-align: center; margin: 20px 0;">Message powered by SoftInvites.</p>

                  <!-- ENHANCED QR CODE SECTION -->
                  <div style="text-align: center; margin: 40px 0; padding: 25px; background: #f8f9fa; border-radius: 10px; border: 2px dashed #7d0e2b;">
                    <p style="font-weight: bold; font-size: 20px; color: #7d0e2b; margin-bottom: 20px;">
                      🎟️ YOUR EVENT PASS - QR CODE REQUIRED FOR ENTRY
                    </p>
                    
                    <div style="text-align: center; margin: 20px 0;">
                      <img src="${qrData.qrCodeUrl}" 
                           alt="[SHOW IMAGES] Your Event QR Code - Required for Entry at ${eventDetails.name}" 
                           width="200" height="200" 
                           style="margin: 15px auto; border: 2px solid #7d0e2b; display: block; border-radius: 8px;" />
                      
                      <div style="background: #fff5f5; padding: 15px; margin: 15px 0; border-radius: 8px; border: 1px solid #ff6b6b;">
                        <p style="color: #d63031; font-weight: bold; margin: 0 0 10px 0; text-align: center;">
                          ⚠️ Can't see the QR code above?
                        </p>
                        <p style="text-align: center; margin: 0;">
                          <a href="${qrData.qrCodeUrl}" 
                             style="color: #ffffff; background-color: #7d0e2b; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin: 5px;">
                             🔍 CLICK TO VIEW YOUR QR CODE
                          </a>
                        </p>
                        <p style="color: #666; font-size: 12px; text-align: center; margin: 10px 0 0 0;">
                          Or look for "Display images" or "Load external content" in your email client
                        </p>
                      </div>
                    </div>
                    
                    <div style="font-size: 10px; color: #999; margin-top: 15px; padding: 10px; background: #fff; border-radius: 5px;">
                      Guest: ${guest.fullname} | Table: ${guest.TableNo || 'N/A'} | ID: ${savedGuest._id.toString().substring(0, 8)}
                    </div>
                  </div>

                  <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; text-align: center; font-size: 12px; color: #666;">
                    <p><strong>SoftInvites</strong><br />Lagos, Nigeria</p>
                    <p style="margin-top: 10px;">
                      You received this email because you have been invited to this event.<br />
                      <a href="#" style="color: #7d0e2b; text-decoration: underline;">Opt Out</a>
                    </p>
                  </footer>
                </div>
              `;
                        await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
                            to: guest.email,
                            subject: `${eventDetails.name} - Invitation - Enable Images for QR Code`,
                            htmlContent: emailContent,
                        }, true);
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
        // 4. Send completion summary to admin
        await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            to: userEmail,
            subject: "Guest Import Completed",
            htmlContent: `
        <h3>Guest Import Completed</h3>
        <p>Event: <strong>${eventDetails.name}</strong></p>
        <p>Total Guests Processed: ${results.length}</p>
        <p>Successful: ${successCount}</p>
        <p>Failed: ${failedCount}</p>
        ${failedCount > 0 ? '<p style="color: #d63031;">Check the logs for details on failed imports.</p>' : ''}
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
