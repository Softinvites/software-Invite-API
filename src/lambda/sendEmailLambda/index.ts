import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { buildRawEmail } from './buildRawEmail.js';

const ses = new SESClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });

interface EmailEvent {
  to: string;
  subject: string;
  htmlContent: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    s3Key?: string;
    content?: string;
    contentType: string;
  }>;
}

export const handler = async (event: EmailEvent) => {
  try {
    const from = event.from || process.env.EMAIL_FROM;

    // ✅ Ensure 'from' is defined
    if (!from) {
      throw new Error("Sender email (from) is required");
    }

    const attachments = await Promise.all(
      (event.attachments || []).map(async (file) => {
        let content: string;
        
        if (file.content) {
          // Direct base64 content provided
          content = file.content;
        } else if (file.s3Key) {
          // S3 attachment - fetch from S3
          const response = await s3.send(new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: file.s3Key,
          }));

          if (!response.Body) {
            throw new Error(`Unable to read S3 object for ${file.filename}`);
          }

          const byteArray = await response.Body.transformToByteArray();
          content = Buffer.from(byteArray).toString("base64");
        } else {
          throw new Error(`Attachment ${file.filename} must have either 'content' or 's3Key'`);
        }

        return {
          filename: file.filename,
          content,
          contentType: file.contentType,
        };
      })
    );

    const rawMessage = buildRawEmail({
      from,
      to: event.to,
      subject: event.subject,
      htmlContent: event.htmlContent,
      attachments,
    });

    await ses.send(
      new SendRawEmailCommand({
        RawMessage: { Data: Buffer.from(rawMessage) },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Email sent successfully" }),
    };
  } catch (error) {
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
