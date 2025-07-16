"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRawEmail = void 0;
const mimetext_1 = require("mimetext");
const buildRawEmail = (options) => {
    const msg = (0, mimetext_1.createMimeMessage)();
    // Set headers
    msg.setSender(options.from);
    msg.setRecipient(options.to);
    msg.setSubject(options.subject);
    // Add HTML content
    msg.addMessage({
        contentType: 'text/html',
        data: options.htmlContent
    });
    // Add attachments if they exist
    if (options.attachments) {
        options.attachments.forEach(attachment => {
            msg.addAttachment({
                filename: attachment.filename,
                contentType: attachment.contentType,
                data: attachment.content,
                encoding: 'base64'
            });
        });
    }
    return msg.asRaw();
};
exports.buildRawEmail = buildRawEmail;
