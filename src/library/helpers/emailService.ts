// library/helpers/emailService.ts
import { invokeLambda } from '../../utils/lambdaUtils';
import { uploadToS3} from '../../utils/s3Utils';

export const sendEmail = async (
  to: string,
  subject: string,
  htmlContent: string,
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>
) => {
  try {
    // Upload attachments to S3 if any
    const attachmentPromises = (attachments || []).map(async (attachment) => {
      const s3Key = `email-attachments/${Date.now()}_${attachment.filename}`;
      await uploadToS3(attachment.content, s3Key, attachment.contentType);
      return {
        filename: attachment.filename,
        s3Key,
        contentType: attachment.contentType
      };
    });

    const emailAttachments = await Promise.all(attachmentPromises);
        // Use custom from address or fallback to environment variable

    // Add more logging
    console.log("Starting Lambda invocation with params:", {
      functionName: process.env.EMAIL_LAMBDA_FUNCTION_NAME,
      payload: {
        from: process.env.EMAIL_FROM,
        to,
        subject,
        htmlContent: htmlContent.substring(0, 100) + "..." // Log first 100 chars
      }
    });

    const result = await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME!, {
      from: process.env.EMAIL_FROM,
      to,
      subject,
      htmlContent,
      attachments: emailAttachments
    });

    console.log("Lambda invocation result:", result);
    return result;

  } catch (error) {
    console.error('Detailed error in sendEmail:', error);
    throw error;
  }
};