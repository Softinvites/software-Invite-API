"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
// library/helpers/emailService.ts
const lambdaUtils_1 = require("../../utils/lambdaUtils");
const s3Utils_1 = require("../../utils/s3Utils");
const sendEmail = (to, subject, htmlContent, attachments) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // If in development, use local email sending
        if (process.env.NODE_ENV === 'development') {
            console.log('Would send email:', { to, subject });
            return;
        }
        // Upload attachments to S3 if any
        const attachmentPromises = (attachments || []).map((attachment) => __awaiter(void 0, void 0, void 0, function* () {
            const s3Key = `email-attachments/${Date.now()}_${attachment.filename}`;
            yield (0, s3Utils_1.uploadToS3)(attachment.content, s3Key, attachment.contentType);
            return {
                filename: attachment.filename,
                s3Key,
                contentType: attachment.contentType
            };
        }));
        const emailAttachments = yield Promise.all(attachmentPromises);
        // Invoke Lambda for production
        yield (0, lambdaUtils_1.invokeLambda)(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            to,
            subject,
            htmlContent,
            attachments: emailAttachments
        });
    }
    catch (error) {
        console.error('Error in sendEmail:', error);
        throw error;
    }
});
exports.sendEmail = sendEmail;
