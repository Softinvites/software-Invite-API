"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
// library/helpers/emailService.ts
const lambdaUtils_1 = require("../../utils/lambdaUtils");
const s3Utils_1 = require("../../utils/s3Utils");
const emailMessage_1 = require("../../models/emailMessage");
const uuid_1 = require("uuid");
const mail_1 = __importDefault(require("@sendgrid/mail"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const resolveTrackingBaseUrl = () => {
    const base = process.env.EMAIL_TRACKING_BASE_URL ||
        process.env.API_BASE_URL ||
        process.env.BACKEND_URL ||
        process.env.SERVER_URL ||
        '';
    return base ? base.replace(/\/$/, '') : '';
};
const appendTrackingPixel = (html, trackingId, baseUrl) => {
    if (!baseUrl)
        return html;
    const pixel = `<img src="${baseUrl}/email/track/open/${trackingId}.png" alt="" width="1" height="1" style="display:none;" />`;
    if (html.includes('</body>')) {
        return html.replace('</body>', `${pixel}</body>`);
    }
    return `${html}${pixel}`;
};
const rewriteLinksForTracking = (html, trackingId, baseUrl) => {
    if (!baseUrl)
        return html;
    return html.replace(/href=["']([^"']+)["']/gi, (match, url) => {
        if (!url)
            return match;
        const lower = url.toLowerCase();
        if (lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('#'))
            return match;
        if (lower.includes('/email/track/click/'))
            return match;
        const tracked = `${baseUrl}/email/track/click/${trackingId}?url=${encodeURIComponent(url)}`;
        return `href="${tracked}"`;
    });
};
const sendEmail = async (to, subject, htmlContent, from, attachments, options) => {
    let trackingRecord = null;
    try {
        const provider = options?.provider ||
            process.env.EMAIL_PROVIDER ||
            (process.env.SMTP_HOST ? 'smtp' : undefined) ||
            (process.env.SENDGRID_API_KEY ? 'sendgrid' : 'ses');
        const trackingEnabled = options?.trackingEnabled !== false;
        const trackingBaseUrl = resolveTrackingBaseUrl();
        const trackingId = trackingEnabled ? (0, uuid_1.v4)() : null;
        let finalHtml = htmlContent;
        if (trackingEnabled && trackingId) {
            finalHtml = rewriteLinksForTracking(finalHtml, trackingId, trackingBaseUrl);
            finalHtml = appendTrackingPixel(finalHtml, trackingId, trackingBaseUrl);
        }
        trackingRecord = trackingId
            ? await emailMessage_1.EmailMessage.create({
                trackingId,
                eventId: options?.eventId || null,
                rsvpId: options?.rsvpId || null,
                guestEmail: to,
                subject,
                messageType: options?.messageType || null,
                status: 'pending',
            })
            : null;
        if (provider === 'sendgrid') {
            if (!process.env.SENDGRID_API_KEY) {
                throw new Error('SENDGRID_API_KEY is not configured');
            }
            mail_1.default.setApiKey(process.env.SENDGRID_API_KEY);
            const sendgridAttachments = attachments?.map((att) => ({
                content: att.content.toString('base64'),
                filename: att.filename,
                type: att.contentType,
                disposition: 'attachment',
            })) || [];
            await mail_1.default.send({
                to,
                from: from || process.env.EMAIL_FROM || 'info@softinvite.com',
                subject,
                html: finalHtml,
                attachments: sendgridAttachments.length ? sendgridAttachments : undefined,
                replyTo: options?.replyTo,
                ...(options?.messageType ? { customArgs: { messageType: options.messageType } } : {}),
            });
            if (trackingRecord) {
                trackingRecord.status = 'sent';
                trackingRecord.sentAt = new Date();
                await trackingRecord.save();
            }
            return { provider: 'sendgrid', status: 'sent', trackingId };
        }
        if (provider === 'smtp') {
            if (!process.env.SMTP_HOST) {
                throw new Error('SMTP_HOST is not configured');
            }
            const transport = nodemailer_1.default.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT || 587),
                secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
                auth: process.env.SMTP_USER
                    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                    : undefined,
            });
            await transport.sendMail({
                from: from || process.env.EMAIL_FROM || 'info@softinvite.com',
                to,
                subject,
                html: finalHtml,
                attachments: attachments?.map((att) => ({
                    filename: att.filename,
                    content: att.content,
                    contentType: att.contentType,
                })),
                replyTo: options?.replyTo,
            });
            if (trackingRecord) {
                trackingRecord.status = 'sent';
                trackingRecord.sentAt = new Date();
                await trackingRecord.save();
            }
            return { provider: 'smtp', status: 'sent', trackingId };
        }
        // Default: SES via Lambda (existing path)
        const attachmentPromises = (attachments || []).map(async (attachment) => {
            const s3Key = `email-attachments/${Date.now()}_${attachment.filename}`;
            await (0, s3Utils_1.uploadToS3)(attachment.content, s3Key, attachment.contentType);
            return {
                filename: attachment.filename,
                s3Key,
                contentType: attachment.contentType,
            };
        });
        const emailAttachments = await Promise.all(attachmentPromises);
        console.log('Starting Lambda invocation with params:', {
            functionName: process.env.EMAIL_LAMBDA_FUNCTION_NAME,
            payload: {
                from: from || process.env.EMAIL_FROM,
                to,
                subject,
                htmlContent: finalHtml.substring(0, 100) + '...',
            },
        });
        const result = await (0, lambdaUtils_1.invokeLambda)(process.env.EMAIL_LAMBDA_FUNCTION_NAME, {
            from: from || process.env.EMAIL_FROM,
            to,
            subject,
            htmlContent: finalHtml,
            attachments: emailAttachments,
            replyTo: options?.replyTo,
        });
        if (trackingRecord) {
            trackingRecord.status = 'sent';
            trackingRecord.sentAt = new Date();
            await trackingRecord.save();
        }
        console.log('Lambda invocation result:', result);
        return { provider: 'ses', status: 'sent', trackingId, result };
    }
    catch (error) {
        console.error('Detailed error in sendEmail:', error);
        if (trackingRecord) {
            try {
                trackingRecord.status = 'failed';
                await trackingRecord.save();
            }
            catch { }
        }
        if (error && typeof error === 'object') {
            try {
                const err = error;
                console.error('Send email error message:', err.message);
            }
            catch { }
        }
        throw error;
    }
};
exports.sendEmail = sendEmail;
