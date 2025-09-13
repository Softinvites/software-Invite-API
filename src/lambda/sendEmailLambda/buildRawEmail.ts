import { createMimeMessage } from 'mimetext';

export interface Attachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface BuildRawEmailOptions {
  from: string;
  to: string;
  subject: string;
  htmlContent: string;
  attachments?: Attachment[];
}

export const buildRawEmail = (options: BuildRawEmailOptions): string => {
  const msg = createMimeMessage() as any;

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