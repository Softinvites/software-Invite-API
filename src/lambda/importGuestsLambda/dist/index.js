import { parseCsvExcel } from "./parseCsvExcel.js";
import { handler as generateQrToS3 } from "./generateQrToS3.js";
import { rgbToHex } from "./colorUtils.js";
import { invokeLambda } from "./lambdaUtils.js";
import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
const s3 = new S3Client({ region: process.env.AWS_REGION });
function parseS3Url(fileUrl) {
    const url = new URL(fileUrl);
    const bucket = url.hostname.split(".")[0]; // e.g. "mybucket" from "mybucket.s3.amazonaws.com"
    const key = decodeURIComponent(url.pathname.slice(1)); // remove leading "/"
    return { bucket, key };
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
                    // Send guest email
                    if (guest.email) {
                        await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
                            to: guest.email,
                            subject: "Your Invitation",
                            htmlContent: `<p>Hello ${guest.fullname}, here is your invitation QR:</p>
                                <p><img src="${qrData.qrCodeUrl}" /></p>`,
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
        <p>Total Guests Processed: ${results.length}</p>
        <p>Successful: ${successCount}</p>
        <p>Failed: ${failedCount}</p>
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
            }),
        };
    }
    catch (error) {
        console.error("❌ Import Lambda error:", error);
        await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            to: userEmail,
            subject: "Guest Import Failed",
            htmlContent: `<p>${error.message}</p>`,
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
