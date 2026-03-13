import { invokeLambda } from "../../utils/lambdaUtils.js";
import { uploadToS3 } from "../../utils/s3Utils.js";

type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

type EmailSendOptions = {
  eventId?: string;
  rsvpId?: string;
  messageType?: string;
  trackingEnabled?: boolean;
  replyTo?: string;
};

export const sendEmail = async (
  to: string,
  subject: string,
  htmlContent: string,
  from?: string,
  attachments?: EmailAttachment[],
  options?: EmailSendOptions,
) => {
  if (!process.env.EMAIL_LAMBDA_FUNCTION_NAME) {
    throw new Error("EMAIL_LAMBDA_FUNCTION_NAME is not configured");
  }

  const uploadTasks = (attachments || []).map(async (attachment) => {
    const safeName = String(attachment.filename || "attachment")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 180);
    const key = `email-attachments/${Date.now()}_${safeName}`;
    await uploadToS3(attachment.content, key, attachment.contentType);
    return {
      filename: attachment.filename,
      s3Key: key,
      contentType: attachment.contentType,
    };
  });
  const s3Attachments = await Promise.all(uploadTasks);

  const payload = {
    from: from || process.env.EMAIL_FROM || "SoftInvites <info@softinvite.com>",
    to,
    subject,
    htmlContent,
    attachments: s3Attachments,
    replyTo: options?.replyTo,
  };

  return invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, payload, false);
};
