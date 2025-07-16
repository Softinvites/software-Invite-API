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
    // If in development, use local email sending
    if (process.env.NODE_ENV === 'development') {
      console.log('Would send email:', { to, subject });
      return;
    }

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

    // Invoke Lambda for production
    await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME!, {
      to,
      subject,
      htmlContent,
      attachments: emailAttachments
    });
  } catch (error) {
    console.error('Error in sendEmail:', error);
    throw error;
  }
};