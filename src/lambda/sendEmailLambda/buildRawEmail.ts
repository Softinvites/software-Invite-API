import { createMimeMessage, Mailbox } from 'mimetext';

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
  replyTo?: string;
  attachments?: Attachment[];
}

export const buildRawEmail = (options: BuildRawEmailOptions): string => {
  const msg = createMimeMessage() as any;

  // Set headers
  msg.setSender(options.from);
  msg.setRecipient(options.to);
  msg.setSubject(options.subject);
  // mimetext v3 validates Reply-To as a Mailbox instance, not a string —
  // passing a plain address throws MIMETEXT_INVALID_HEADER_VALUE and takes the
  // whole send down with it. Wrap it, and never let a malformed address cost us
  // the email: the body always carries the sender's address anyway.
  if (options.replyTo) {
    // Mailbox('') happily yields "Reply-To: <>", which SES rejects, so sanity
    // check the address ourselves rather than relying on a throw.
    const replyTo = options.replyTo.trim();
    const looksLikeAddress = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(
      replyTo.replace(/^.*<|>.*$/g, '').trim(),
    );

    if (looksLikeAddress) {
      try {
        // No config object: MailboxType has no 'Reply-To' member, and the field
        // only sets an internal property — setHeader supplies the header name.
        msg.setHeader('Reply-To', new Mailbox(replyTo));
      } catch (error) {
        console.warn(`Skipping invalid Reply-To "${replyTo}":`, (error as Error)?.message);
      }
    } else {
      console.warn(`Skipping malformed Reply-To "${replyTo}"`);
    }
  }

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
