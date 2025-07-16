import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { buildRawEmail } from './buildRawEmail.js';
const ses = new SESClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
export const handler = async (event) => {
    try {
        const from = event.from || process.env.EMAIL_FROM;
        // ✅ Ensure 'from' is defined
        if (!from) {
            throw new Error("Sender email (from) is required");
        }
        const attachments = await Promise.all((event.attachments || []).map(async (file) => {
            const response = await s3.send(new GetObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: file.s3Key,
            }));
            if (!response.Body) {
                throw new Error(`Unable to read S3 object for ${file.filename}`);
            }
            // ✅ Ensure Body is converted to base64 safely
            const byteArray = await response.Body.transformToByteArray();
            const base64 = Buffer.from(byteArray).toString("base64");
            return {
                filename: file.filename,
                content: base64,
                contentType: file.contentType,
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
        console.error("Error sending email:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Failed to send email",
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        };
    }
};
