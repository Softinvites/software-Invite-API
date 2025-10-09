"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
// library/helpers/emailService.ts
const lambdaUtils_1 = require("../../utils/lambdaUtils");
const s3Utils_1 = require("../../utils/s3Utils");
const sendEmail = async (to, subject, htmlContent, attachments) => {
    try {
        // If in development, use local email sending
        // if (process.env.NODE_ENV === 'development') {
        //   console.log('Would send email:', { to, subject });
        //   return;
        // }
        // Upload attachments to S3 if any
        const attachmentPromises = (attachments || []).map(async (attachment) => {
            const s3Key = `email-attachments/${Date.now()}_${attachment.filename}`;
            await (0, s3Utils_1.uploadToS3)(attachment.content, s3Key, attachment.contentType);
            return {
                filename: attachment.filename,
                s3Key,
                contentType: attachment.contentType
            };
        });
        const emailAttachments = await Promise.all(attachmentPromises);
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
        const result = await (0, lambdaUtils_1.invokeLambda)(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            from: process.env.EMAIL_FROM,
            to,
            subject,
            htmlContent,
            attachments: emailAttachments
        });
        console.log("Lambda invocation result:", result);
        return result;
    }
    catch (error) {
        console.error('Detailed error in sendEmail:', error);
        throw error;
    }
};
exports.sendEmail = sendEmail;
