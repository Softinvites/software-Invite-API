import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { buildRawEmail } from "./buildRawEmail.js";
const ses = new SESClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
export const handler = async (event) => {
    try {
        // ✅ DYNAMIC "FROM" — EVENT NAME TAKES PRIORITY
        const from = event.from ||
            (event.eventName
                ? `${event.eventName} <info@softinvite.com>`
                : process.env.EMAIL_FROM);
        if (!from) {
            throw new Error("Sender email (from) is required");
        }
        // ✅ LOAD ATTACHMENTS FROM S3 (OPTIONAL)
        const attachments = await Promise.all((event.attachments || []).map(async (file) => {
            const response = await s3.send(new GetObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: file.s3Key,
            }));
            if (!response.Body) {
                throw new Error(`Unable to read S3 object for ${file.filename}`);
            }
            const byteArray = await response.Body.transformToByteArray();
            const base64 = Buffer.from(byteArray).toString("base64");
            // Prefer explicit file.contentType, fall back to S3 object's ContentType, then generic
            const contentType = file.contentType ||
                response.ContentType ||
                "application/octet-stream";
            return {
                filename: file.filename,
                content: base64,
                contentType,
            };
        }));
        const rawMessage = buildRawEmail({
            from,
            to: event.to,
            subject: event.subject,
            htmlContent: event.htmlContent,
            attachments,
        });
        await ses.send(new SendRawEmailCommand({
            RawMessage: { Data: Buffer.from(rawMessage) },
        }));
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Email sent successfully" }),
        };
    }
    catch (error) {
        console.error("❌ Error sending email:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Failed to send email",
                error: error.message || "Unknown error",
            }),
        };
    }
};
