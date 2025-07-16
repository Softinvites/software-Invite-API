import { createMimeMessage } from 'mimetext';
export const buildRawEmail = (options) => {
    const msg = createMimeMessage();
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
