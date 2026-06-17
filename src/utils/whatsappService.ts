// import axios from 'axios';
// import mongoose from 'mongoose';
// import twilio from 'twilio';
// import { WhatsAppMessage } from '../models/WhatsAppMessage.js';
// import { WhatsAppTemplate } from '../models/WhatsAppTemplate.js';
// import { buildWhatsAppTemplateParams } from './whatsappTemplateParams.js';

// interface Guest {
//   _id: string;
//   fullname: string;
//   phone?: string;
//   qrCode?: string;
//   pngUrl?: string;
// }

// interface EventData {
//   _id: string;
//   name: string;
//   venue?: string;
//   location?: string;
//   date?: string;
//   iv?: string;
// }

// interface SendResult {
//   success: boolean;
//   messageId?: string;
//   recordId?: string;
//   error?: string;
// }

// interface BulkResult {
//   total: number;
//   sent: number;
//   failed: number;
//   details: Array<{
//     guestId: string;
//     name: string;
//     messageId?: string;
//     error?: string;
//     status: string;
//   }>;
// }

// interface TwilioTemplateConfig {
//   contentSid: string | null;
//   statusCallbackUrl: string | null;
// }

// type SendTemplateOptions = {
//   mediaUrl?: string | null;
// };

// type TemplateVariables = Record<string, string> | null;

// type BulkSendOptions = {
//   templateVariables?: TemplateVariables;
// };

// class WhatsAppService {
//   private baseURL: string;
//   private accessToken: string;
//   private provider: string;

//   constructor() {
//     this.baseURL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;
//     this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
//     this.provider = (
//       process.env.WHATSAPP_PROVIDER ||
//       (process.env.TERMII_API_KEY ? 'termii' : process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'meta')
//     ).toLowerCase();
//   }

//   private looksLikeTwilioContentSid(value: string): boolean {
//     return /^HX[0-9a-fA-F]{32}$/.test(String(value || '').trim());
//   }

//   private sanitizeTwilioContentVariableValue(value: unknown): string {
//     // Twilio Content Variables constraints (21656):
//     // - Must not be null/empty at send-time
//     // - Body variables cannot contain newlines/tabs or >4 consecutive spaces
//     // - Some accounts also hit 21656 when values contain straight apostrophes (')
//     const normalized = String(value ?? '')
//       .replace(/\s+/g, ' ')
//       .replace(/'/g, '’')
//       .trim();

//     return normalized || '—';
//   }

//   private buildTwilioContentVariables(templateParams: string[]): string {
//     const variables: Record<string, string> = {};
//     templateParams.forEach((param, index) => {
//       variables[String(index + 1)] = this.sanitizeTwilioContentVariableValue(param);
//     });
//     return JSON.stringify(variables);
//   }

//   private async resolveTwilioTemplateConfig(
//     templateName: string,
//     eventId: string
//   ): Promise<TwilioTemplateConfig> {
//     if (this.looksLikeTwilioContentSid(templateName)) {
//       return {
//         contentSid: templateName,
//         statusCallbackUrl: process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL || null,
//       };
//     }

//     const envKey = `TWILIO_CONTENT_SID_${templateName
//       .toUpperCase()
//       .replace(/[^A-Z0-9]+/g, '_')}`;
//     const envContentSid = process.env[envKey];

//     const templateDoc = (await WhatsAppTemplate.findOne({
//       eventId,
//       $or: [{ name: templateName }, { displayName: templateName }],
//       isActive: true,
//     })
//       .select({ contentSid: 1, statusCallbackUrl: 1 })
//       .lean()) as {
//       contentSid?: string | null;
//       statusCallbackUrl?: string | null;
//     } | null;

//     return {
//       contentSid: templateDoc?.contentSid || envContentSid || null,
//       statusCallbackUrl:
//         templateDoc?.statusCallbackUrl ||
//         process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL ||
//         null,
//     };
//   }

//   async sendTemplateMessage(
//     phoneNumber: string, 
//     templateName: string, 
//     templateParams: string[], 
//     guestId: string, 
//     eventId: string,
//     options: SendTemplateOptions = {}
//   ): Promise<SendResult> {
//     try {
//       if (!phoneNumber) {
//         return { success: false, error: 'Missing phone number' };
//       }
//       let providerMessageId = '';
//       if (this.provider === 'twilio') {
//         if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
//           throw new Error('Twilio credentials not configured');
//         }
//         const client = twilio(
//           process.env.TWILIO_ACCOUNT_SID,
//           process.env.TWILIO_AUTH_TOKEN
//         );
//         const from = process.env.TWILIO_WHATSAPP_FROM;
//         if (!from) throw new Error('TWILIO_WHATSAPP_FROM not configured');
//         const to = phoneNumber.startsWith('whatsapp:')
//           ? phoneNumber
//           : `whatsapp:${phoneNumber}`;
//         const { contentSid, statusCallbackUrl } =
//           await this.resolveTwilioTemplateConfig(templateName, eventId);

//         const messagePayload: Record<string, unknown> = {
//           from,
//           to,
//           ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
//         };

//         if (contentSid) {
//           messagePayload.contentSid = contentSid;
//           messagePayload.contentVariables = this.buildTwilioContentVariables(
//             templateParams || []
//           );
//         } else {
//           messagePayload.body = templateParams?.length
//             ? `${templateName}: ${templateParams.join(' | ')}`
//             : `${templateName}`;
//         }

//         const response = await client.messages.create(messagePayload as any);
//         providerMessageId = response.sid;
//       } else if (this.provider === 'termii') {
//         const apiKey = process.env.TERMII_API_KEY;
//         if (!apiKey) throw new Error('TERMII_API_KEY not configured');
//         const baseUrl = process.env.TERMII_BASE_URL || 'https://api.ng.termii.com';
//         const url =
//           process.env.TERMII_WHATSAPP_URL ||
//           `${baseUrl.replace(/\/$/, '')}/api/whatsapp/send`;
//         const payload = {
//           to: phoneNumber,
//           message: templateParams?.length
//             ? templateParams.join(' ')
//             : templateName,
//           api_key: apiKey,
//         };
//         const response = await axios.post(url, payload);
//         providerMessageId =
//           response.data?.message_id ||
//           response.data?.messageId ||
//           response.data?.data?.message_id ||
//           `termii_${Date.now()}`;
//       } else {
//         if (!this.accessToken || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
//           throw new Error('Meta WhatsApp credentials not configured');
//         }
//         const mediaUrl = String(options?.mediaUrl || '').trim();
//         const payload = {
//           messaging_product: "whatsapp",
//           to: phoneNumber,
//           type: "template",
//           template: {
//             name: templateName,
//             language: { code: "en_US" },
//             components: [
//               ...(mediaUrl
//                 ? [
//                     {
//                       type: "header",
//                       parameters: [
//                         {
//                           type: "image",
//                           image: { link: mediaUrl },
//                         },
//                       ],
//                     },
//                   ]
//                 : []),
//               {
//                 type: "body",
//                 parameters: templateParams.map(param => ({ type: "text", text: param }))
//               }
//             ]
//           }
//         };

//         const response = await axios.post(
//           `${this.baseURL}/messages`,
//           payload,
//           {
//             headers: {
//               'Authorization': `Bearer ${this.accessToken}`,
//               'Content-Type': 'application/json'
//             }
//           }
//         );
//         providerMessageId = response.data.messages[0].id;
//       }

//       const messageRecord = new WhatsAppMessage({
//         guestId,
//         eventId,
//         templateName,
//         providerMessageId,
//         phoneNumber,
//         status: 'sent'
//       });

//       await messageRecord.save();

//       return {
//         success: true,
//         messageId: providerMessageId,
//         recordId: messageRecord._id.toString()
//       };

//     } catch (error: any) {
//       console.error('WhatsApp send error:', error.response?.data || error.message);
      
//       const messageRecord = new WhatsAppMessage({
//         guestId,
//         eventId,
//         templateName,
//         providerMessageId: `failed_${Date.now()}`,
//         phoneNumber,
//         status: 'failed',
//         errorMessage: error.response?.data?.error?.message || error.message
//       });

//       await messageRecord.save();

//       return {
//         success: false,
//         error: error.response?.data?.error?.message || error.message,
//         recordId: messageRecord._id.toString()
//       };
//     }
//   }

//   async sendTextMessage(
//     phoneNumber: string,
//     message: string,
//     guestId: string | null,
//     eventId: string
//   ): Promise<SendResult> {
//     try {
//       if (!phoneNumber) {
//         return { success: false, error: 'Missing phone number' };
//       }
//       const trimmedMessage = String(message || '').trim();
//       if (!trimmedMessage) {
//         return { success: false, error: 'Message body is required' };
//       }

//       let providerMessageId = '';
//       if (this.provider === 'twilio') {
//         if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
//           throw new Error('Twilio credentials not configured');
//         }
//         const client = twilio(
//           process.env.TWILIO_ACCOUNT_SID,
//           process.env.TWILIO_AUTH_TOKEN
//         );
//         const from = process.env.TWILIO_WHATSAPP_FROM;
//         if (!from) throw new Error('TWILIO_WHATSAPP_FROM not configured');
//         const to = phoneNumber.startsWith('whatsapp:')
//           ? phoneNumber
//           : `whatsapp:${phoneNumber}`;
//         const response = await client.messages.create({
//           from,
//           to,
//           body: trimmedMessage,
//           ...(process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL
//             ? { statusCallback: process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL }
//             : {}),
//         } as any);
//         providerMessageId = response.sid;
//       } else if (this.provider === 'termii') {
//         const apiKey = process.env.TERMII_API_KEY;
//         if (!apiKey) throw new Error('TERMII_API_KEY not configured');
//         const baseUrl = process.env.TERMII_BASE_URL || 'https://api.ng.termii.com';
//         const url =
//           process.env.TERMII_WHATSAPP_URL ||
//           `${baseUrl.replace(/\/$/, '')}/api/whatsapp/send`;
//         const response = await axios.post(url, {
//           to: phoneNumber,
//           message: trimmedMessage,
//           api_key: apiKey,
//         });
//         providerMessageId =
//           response.data?.message_id ||
//           response.data?.messageId ||
//           response.data?.data?.message_id ||
//           `termii_${Date.now()}`;
//       } else {
//         if (!this.accessToken || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
//           throw new Error('Meta WhatsApp credentials not configured');
//         }
//         const payload = {
//           messaging_product: 'whatsapp',
//           to: phoneNumber,
//           type: 'text',
//           text: { body: trimmedMessage },
//         };
//         const response = await axios.post(
//           `${this.baseURL}/messages`,
//           payload,
//           {
//             headers: {
//               Authorization: `Bearer ${this.accessToken}`,
//               'Content-Type': 'application/json',
//             },
//           }
//         );
//         providerMessageId = response.data?.messages?.[0]?.id || `meta_${Date.now()}`;
//       }

//       const messageRecord = new WhatsAppMessage({
//         ...(guestId ? { guestId } : {}),
//         eventId,
//         templateName: 'manual_reply',
//         providerMessageId,
//         phoneNumber,
//         status: 'sent',
//       });
//       await messageRecord.save();

//       return {
//         success: true,
//         messageId: providerMessageId,
//         recordId: messageRecord._id.toString(),
//       };
//     } catch (error: any) {
//       console.error('WhatsApp text send error:', error.response?.data || error.message);

//       const messageRecord = new WhatsAppMessage({
//         ...(guestId ? { guestId } : {}),
//         eventId,
//         templateName: 'manual_reply',
//         providerMessageId: `failed_${Date.now()}`,
//         phoneNumber,
//         status: 'failed',
//         errorMessage: error.response?.data?.error?.message || error.message,
//       });
//       await messageRecord.save();

//       return {
//         success: false,
//         error: error.response?.data?.error?.message || error.message,
//         recordId: messageRecord._id.toString(),
//       };
//     }
//   }

//   async sendBulkMessages(
//     guests: Guest[],
//     eventData: EventData,
//     templateName: string,
//     options: BulkSendOptions = {}
//   ): Promise<BulkResult> {
//     // For large batches (>100 guests), delegate to Lambda
//     if (guests.length > 100) {
//       console.log(`Large batch detected (${guests.length} guests), delegating to Lambda`);
      
//       try {
//         const { invokeLambda } = await import('./lambdaUtils.js');
        
//         await invokeLambda(
//           process.env.WHATSAPP_LAMBDA_FUNCTION_NAME!,
//           {
//             eventId: eventData._id,
//             templateName,
//             guestIds: guests.map(g => g._id),
//             ...(options.templateVariables ? { templateVariables: options.templateVariables } : {})
//           },
//           true // async invoke
//         );

//         console.log('✅ WhatsApp Lambda job started successfully');
        
//         return {
//           total: guests.length,
//           sent: 0,
//           failed: 0,
//           details: [{
//             guestId: 'lambda_job',
//             name: 'Lambda Processing Started',
//             status: 'processing',
//             messageId: `Lambda job initiated for ${guests.length} guests`
//           }]
//         };
//       } catch (error) {
//         console.error('Lambda delegation failed, falling back to direct processing:', error);
//         // Fall back to direct processing below
//       }
//     }

//     // Direct processing for smaller batches
//     const results: BulkResult = {
//       total: guests.length,
//       sent: 0,
//       failed: 0,
//       details: []
//     };

//     const BATCH_SIZE = 10; // Optimized for WhatsApp Tier 1 (50 msg/sec)
//     const DELAY_MS = 250;   // 250ms delay = ~40 msg/sec
//     for (let i = 0; i < guests.length; i += BATCH_SIZE) {
//       const batch = guests.slice(i, i + BATCH_SIZE);
      
//       await Promise.allSettled(
//         batch.map(async (guest) => {
//           if (!guest.phone) {
//             results.failed++;
//             results.details.push({
//               guestId: guest._id,
//               name: guest.fullname,
//               error: 'No phone number',
//               status: 'failed'
//             });
//             return;
//           }

//           const { templateParams, mediaUrl } = this.buildTemplateParams(
//             guest,
//             eventData,
//             templateName,
//             options.templateVariables || null
//           );
//           const result = await this.sendTemplateMessage(
//             guest.phone,
//             templateName,
//             templateParams,
//             guest._id,
//             eventData._id,
//             { mediaUrl }
//           );

//           if (result.success) {
//             results.sent++;
//             results.details.push({
//               guestId: guest._id,
//               name: guest.fullname,
//               messageId: result.messageId,
//               status: 'sent'
//             });
//           } else {
//             results.failed++;
//             results.details.push({
//               guestId: guest._id,
//               name: guest.fullname,
//               error: result.error,
//               status: 'failed'
//             });
//           }

//           // WhatsApp rate limiting - optimized for Tier 1
//           await new Promise(resolve => setTimeout(resolve, DELAY_MS));
//         })
//       );

//       console.log(`WhatsApp batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
//     }

//     return results;
//   }

//   private buildTemplateParams(
//     guest: Guest,
//     eventData: EventData,
//     templateName: string,
//     templateVariables: TemplateVariables
//   ): { templateParams: string[]; mediaUrl: string | null } {
//     const normalizedTemplate = String(templateName || '').toLowerCase().trim();
//     const eventId = String(eventData?._id || '').trim();
//     const bucket = String(process.env.S3_BUCKET || '').trim();
//     const region = String(process.env.AWS_REGION || '').trim();

//     const buildQrEmailPngUrl = () => {
//       if (!bucket || !region || !eventId) return '';
//       return `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/email_png/${eventId}/${guest._id}.png`;
//     };

//     const qrCodeUrl =
//       normalizedTemplate === 'rsvp_followup' || normalizedTemplate === 'wedding_invite'
//         ? buildQrEmailPngUrl() ||
//           guest.pngUrl ||
//           (guest.qrCode?.includes('.png')
//             ? guest.qrCode
//             : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`)
//         : guest.pngUrl ||
//           (guest.qrCode?.includes('.png')
//             ? guest.qrCode
//             : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`);

//     const templateParams = buildWhatsAppTemplateParams({
//       templateName,
//       recipientName: guest.fullname,
//       eventName: eventData.name,
//       location: (eventData as any).location || (eventData as any).venue || 'TBA',
//       eventDate: eventData.date || 'TBA',
//       passUrl: qrCodeUrl,
//       eventIv: eventData.iv || null,
//       templateVariables: templateVariables || undefined,
//     });

//     const mediaUrl =
//       normalizedTemplate === 'wedding_invite' && String(eventData.iv || '').trim()
//         ? String(eventData.iv).trim()
//         : null;

//     return { templateParams, mediaUrl };
//   }

//   async updateMessageStatus(
//     providerMessageId: string,
//     status: string,
//     timestamp?: number,
//     errorMessage?: string
//   ): Promise<boolean> {
//     try {
//       const normalizedStatus =
//         status === 'undelivered'
//           ? 'failed'
//           : status === 'received'
//             ? 'sent'
//             : status;
//       const updateData: any = { status: normalizedStatus };
      
//       if (timestamp) {
//         if (normalizedStatus === 'delivered') updateData.deliveredAt = new Date(timestamp * 1000);
//         if (normalizedStatus === 'read') updateData.readAt = new Date(timestamp * 1000);
//       }

//       if (errorMessage && normalizedStatus === 'failed') {
//         updateData.errorMessage = errorMessage;
//       }

//       await WhatsAppMessage.findOneAndUpdate(
//         { providerMessageId },
//         updateData
//       );

//       return true;
//     } catch (error) {
//       console.error('Status update error:', error);
//       return false;
//     }
//   }

//   async getMessageStats(eventId: string) {
//     const stats = await WhatsAppMessage.aggregate([
//       { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
//       {
//         $group: {
//           _id: '$status',
//           count: { $sum: 1 }
//         }
//       }
//     ]);

//     const result = {
//       total: 0,
//       sent: 0,
//       delivered: 0,
//       read: 0,
//       failed: 0,
//       not_on_whatsapp: 0
//     };

//     stats.forEach((stat: any) => {
//       result[stat._id as keyof typeof result] = stat.count;
//       result.total += stat.count;
//     });

//     return result;
//   }
// }

// export default new WhatsAppService();



import axios from 'axios';
import mongoose from 'mongoose';
import twilio from 'twilio';
import { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import { WhatsAppTemplate } from '../models/WhatsAppTemplate.js';
import { buildWhatsAppTemplateParams } from './whatsappTemplateParams.js';

interface Guest {
  _id: string;
  fullname: string;
  phone?: string;
  qrCode?: string;
  pngUrl?: string;
}

interface EventData {
  _id: string;
  name: string;
  venue?: string;
  location?: string;
  date?: string;
  iv?: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  recordId?: string;
  error?: string;
}

interface BulkResult {
  total: number;
  sent: number;
  failed: number;
  details: Array<{
    guestId: string;
    name: string;
    messageId?: string;
    error?: string;
    status: string;
  }>;
}

interface TwilioTemplateConfig {
  contentSid: string | null;
  statusCallbackUrl: string | null;
}

type SendTemplateOptions = {
  mediaUrl?: string | null;
};

type TemplateVariables = Record<string, string> | null;

type BulkSendOptions = {
  templateVariables?: TemplateVariables;
  formLinkPath?: string | null;
};

class WhatsAppService {
  private baseURL: string;
  private accessToken: string;
  private provider: string;

  constructor() {
    this.baseURL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.provider = (
      process.env.WHATSAPP_PROVIDER ||
      (process.env.TERMII_API_KEY ? 'termii' : process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'meta')
    ).toLowerCase();
  }

  private looksLikeTwilioContentSid(value: string): boolean {
    return /^HX[0-9a-fA-F]{32}$/.test(String(value || '').trim());
  }

  private sanitizeTwilioContentVariableValue(value: unknown): string {
    const normalized = String(value ?? '')
      .replace(/[\r\n\t]/g, ' ')       // remove newlines and tabs
      .replace(/ {5,}/g, '    ')        // collapse 5+ spaces to 4
      .replace(/[\u2018\u2019]/g, "'")  // curly apostrophes to straight
      .replace(/[\u201C\u201D]/g, '"')  // curly quotes to straight
      .replace(/[\u2013\u2014]/g, '-')  // em/en dash to hyphen
      .trim();
    return normalized || '-';
  }

  private buildTwilioContentVariables(templateParams: string[]): string {
    const variables: Record<string, string> = {};
    templateParams.forEach((param, index) => {
      variables[String(index + 1)] = this.sanitizeTwilioContentVariableValue(param);
    });
    return JSON.stringify(variables);
  }

  private async resolveTwilioTemplateConfig(
    templateName: string,
    eventId: string
  ): Promise<TwilioTemplateConfig> {
    if (this.looksLikeTwilioContentSid(templateName)) {
      return {
        contentSid: templateName,
        statusCallbackUrl: process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL || null,
      };
    }

    const envKey = `TWILIO_CONTENT_SID_${templateName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')}`;
    const envContentSid = process.env[envKey];

    const templateDoc = (await WhatsAppTemplate.findOne({
      eventId,
      $or: [{ name: templateName }, { displayName: templateName }],
      isActive: true,
    })
      .select({ contentSid: 1, statusCallbackUrl: 1 })
      .lean()) as {
      contentSid?: string | null;
      statusCallbackUrl?: string | null;
    } | null;

    // Look up DB-stored Content templates (created via the WhatsApp Template
    // Manager). An APPROVED Manager template is authoritative — its contentSid
    // takes priority over the hardcoded env-var SID, so re-creating a template
    // like rsvp_followup in the Manager swaps it in without code changes.
    let dbContentSid: string | null = null;
    try {
      const { WhatsAppContentTemplate } = await import(
        '../models/WhatsAppContentTemplate.js'
      );
      const dbDoc = await (WhatsAppContentTemplate as any)
        .findOne({ friendlyName: templateName, approvalStatus: 'approved' })
        .select({ contentSid: 1 })
        .lean();
      dbContentSid = dbDoc?.contentSid || null;
    } catch {
      /* ignore - DB content template lookup is best-effort */
    }

    return {
      // Priority: approved Manager template > per-event template > env-var
      // hardcoded SID. Falls through to old behavior when no Manager template.
      contentSid:
        dbContentSid || templateDoc?.contentSid || envContentSid || null,
      statusCallbackUrl:
        templateDoc?.statusCallbackUrl ||
        process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL ||
        null,
    };
  }

  async sendTemplateMessage(
    phoneNumber: string, 
    templateName: string, 
    templateParams: string[], 
    guestId: string, 
    eventId: string,
    options: SendTemplateOptions = {}
  ): Promise<SendResult> {
    try {
      if (!phoneNumber) {
        return { success: false, error: 'Missing phone number' };
      }
      let providerMessageId = '';
      if (this.provider === 'twilio') {
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
          throw new Error('Twilio credentials not configured');
        }
        const client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        const from = process.env.TWILIO_WHATSAPP_FROM;
        if (!from) throw new Error('TWILIO_WHATSAPP_FROM not configured');
        const to = phoneNumber.startsWith('whatsapp:')
          ? phoneNumber
          : `whatsapp:${phoneNumber}`;
        const { contentSid, statusCallbackUrl } =
          await this.resolveTwilioTemplateConfig(templateName, eventId);

        const messagePayload: Record<string, unknown> = {
          from,
          to,
          ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
        };

        if (contentSid) {
          messagePayload.contentSid = contentSid;
          messagePayload.contentVariables = this.buildTwilioContentVariables(
            templateParams || []
          );
        } else {
          messagePayload.body = templateParams?.length
            ? `${templateName}: ${templateParams.join(' | ')}`
            : `${templateName}`;
        }

        const response = await client.messages.create(messagePayload as any);
        providerMessageId = response.sid;
      } else if (this.provider === 'termii') {
        const apiKey = process.env.TERMII_API_KEY;
        if (!apiKey) throw new Error('TERMII_API_KEY not configured');
        const baseUrl = process.env.TERMII_BASE_URL || 'https://api.ng.termii.com';
        const url =
          process.env.TERMII_WHATSAPP_URL ||
          `${baseUrl.replace(/\/$/, '')}/api/whatsapp/send`;
        const payload = {
          to: phoneNumber,
          message: templateParams?.length
            ? templateParams.join(' ')
            : templateName,
          api_key: apiKey,
        };
        const response = await axios.post(url, payload);
        providerMessageId =
          response.data?.message_id ||
          response.data?.messageId ||
          response.data?.data?.message_id ||
          `termii_${Date.now()}`;
      } else {
        if (!this.accessToken || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
          throw new Error('Meta WhatsApp credentials not configured');
        }
        const mediaUrl = String(options?.mediaUrl || '').trim();
        const payload = {
          messaging_product: "whatsapp",
          to: phoneNumber,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en_US" },
            components: [
              ...(mediaUrl
                ? [
                    {
                      type: "header",
                      parameters: [
                        {
                          type: "image",
                          image: { link: mediaUrl },
                        },
                      ],
                    },
                  ]
                : []),
              {
                type: "body",
                parameters: templateParams.map(param => ({ type: "text", text: param }))
              }
            ]
          }
        };

        const response = await axios.post(
          `${this.baseURL}/messages`,
          payload,
          {
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        providerMessageId = response.data.messages[0].id;
      }

      const messageRecord = new WhatsAppMessage({
        guestId,
        eventId,
        templateName,
        providerMessageId,
        phoneNumber,
        status: 'sent'
      });

      await messageRecord.save();

      return {
        success: true,
        messageId: providerMessageId,
        recordId: messageRecord._id.toString()
      };

    } catch (error: any) {
      console.error('WhatsApp send error:', error.response?.data || error.message);
      
      const messageRecord = new WhatsAppMessage({
        guestId,
        eventId,
        templateName,
        providerMessageId: `failed_${Date.now()}`,
        phoneNumber,
        status: 'failed',
        errorMessage: error.response?.data?.error?.message || error.message
      });

      await messageRecord.save();

      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
        recordId: messageRecord._id.toString()
      };
    }
  }

  async sendTextMessage(
    phoneNumber: string,
    message: string,
    guestId: string | null,
    eventId: string
  ): Promise<SendResult> {
    try {
      if (!phoneNumber) {
        return { success: false, error: 'Missing phone number' };
      }
      const trimmedMessage = String(message || '').trim();
      if (!trimmedMessage) {
        return { success: false, error: 'Message body is required' };
      }

      let providerMessageId = '';
      if (this.provider === 'twilio') {
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
          throw new Error('Twilio credentials not configured');
        }
        const client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        const from = process.env.TWILIO_WHATSAPP_FROM;
        if (!from) throw new Error('TWILIO_WHATSAPP_FROM not configured');
        const to = phoneNumber.startsWith('whatsapp:')
          ? phoneNumber
          : `whatsapp:${phoneNumber}`;
        const response = await client.messages.create({
          from,
          to,
          body: trimmedMessage,
          ...(process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL
            ? { statusCallback: process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL }
            : {}),
        } as any);
        providerMessageId = response.sid;
      } else if (this.provider === 'termii') {
        const apiKey = process.env.TERMII_API_KEY;
        if (!apiKey) throw new Error('TERMII_API_KEY not configured');
        const baseUrl = process.env.TERMII_BASE_URL || 'https://api.ng.termii.com';
        const url =
          process.env.TERMII_WHATSAPP_URL ||
          `${baseUrl.replace(/\/$/, '')}/api/whatsapp/send`;
        const response = await axios.post(url, {
          to: phoneNumber,
          message: trimmedMessage,
          api_key: apiKey,
        });
        providerMessageId =
          response.data?.message_id ||
          response.data?.messageId ||
          response.data?.data?.message_id ||
          `termii_${Date.now()}`;
      } else {
        if (!this.accessToken || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
          throw new Error('Meta WhatsApp credentials not configured');
        }
        const payload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'text',
          text: { body: trimmedMessage },
        };
        const response = await axios.post(
          `${this.baseURL}/messages`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        providerMessageId = response.data?.messages?.[0]?.id || `meta_${Date.now()}`;
      }

      const messageRecord = new WhatsAppMessage({
        ...(guestId ? { guestId } : {}),
        eventId,
        templateName: 'manual_reply',
        providerMessageId,
        phoneNumber,
        status: 'sent',
      });
      await messageRecord.save();

      return {
        success: true,
        messageId: providerMessageId,
        recordId: messageRecord._id.toString(),
      };
    } catch (error: any) {
      console.error('WhatsApp text send error:', error.response?.data || error.message);

      const messageRecord = new WhatsAppMessage({
        ...(guestId ? { guestId } : {}),
        eventId,
        templateName: 'manual_reply',
        providerMessageId: `failed_${Date.now()}`,
        phoneNumber,
        status: 'failed',
        errorMessage: error.response?.data?.error?.message || error.message,
      });
      await messageRecord.save();

      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
        recordId: messageRecord._id.toString(),
      };
    }
  }

  async sendBulkMessages(
    guests: Guest[],
    eventData: EventData,
    templateName: string,
    options: BulkSendOptions = {}
  ): Promise<BulkResult> {
    // For large batches (>100 guests), delegate to Lambda
    if (guests.length > 100) {
      console.log(`Large batch detected (${guests.length} guests), delegating to Lambda`);
      
      try {
        const { invokeLambda } = await import('./lambdaUtils.js');
        
        await invokeLambda(
          process.env.WHATSAPP_LAMBDA_FUNCTION_NAME!,
          {
            eventId: eventData._id,
            templateName,
            guestIds: guests.map(g => g._id),
            ...(options.templateVariables ? { templateVariables: options.templateVariables } : {}),
            ...(options.formLinkPath ? { formLinkPath: options.formLinkPath } : {}),
          },
          true // async invoke
        );

        console.log('✅ WhatsApp Lambda job started successfully');
        
        return {
          total: guests.length,
          sent: 0,
          failed: 0,
          details: [{
            guestId: 'lambda_job',
            name: 'Lambda Processing Started',
            status: 'processing',
            messageId: `Lambda job initiated for ${guests.length} guests`
          }]
        };
      } catch (error) {
        console.error('Lambda delegation failed, falling back to direct processing:', error);
        // Fall back to direct processing below
      }
    }

    // Direct processing for smaller batches
    const results: BulkResult = {
      total: guests.length,
      sent: 0,
      failed: 0,
      details: []
    };

    const BATCH_SIZE = 10;
    const DELAY_MS = 250;
    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);
      
      await Promise.allSettled(
        batch.map(async (guest) => {
          const normalizedPhone = guest.phone
            ? guest.phone.replace(/\s+/g, '').replace(/[^\d+]/g, '')
            : '';

          if (!normalizedPhone) {
            results.failed++;
            results.details.push({
              guestId: guest._id,
              name: guest.fullname,
              error: 'No phone number',
              status: 'failed'
            });
            return;
          }

          const { templateParams, mediaUrl } = await this.buildTemplateParams(
            guest,
            eventData,
            templateName,
            options.templateVariables || null,
            { formLinkPath: options.formLinkPath || null }
          );
          const result = await this.sendTemplateMessage(
            normalizedPhone,
            templateName,
            templateParams,
            guest._id,
            eventData._id,
            { mediaUrl }
          );

          if (result.success) {
            results.sent++;
            results.details.push({
              guestId: guest._id,
              name: guest.fullname,
              messageId: result.messageId,
              status: 'sent'
            });
          } else {
            results.failed++;
            results.details.push({
              guestId: guest._id,
              name: guest.fullname,
              error: result.error,
              status: 'failed'
            });
          }

          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        })
      );

      console.log(`WhatsApp batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
    }

    return results;
  }

  private async buildTemplateParams(
    guest: Guest,
    eventData: EventData,
    templateName: string,
    templateVariables: TemplateVariables,
    extras?: { formLinkPath?: string | null }
  ): Promise<{ templateParams: string[]; mediaUrl: string | null }> {
    const normalizedTemplate = String(templateName || '').toLowerCase().trim();
    const eventId = String(eventData?._id || '').trim();
    const bucket = String(process.env.S3_BUCKET || '').trim();
    const region = String(process.env.AWS_REGION || '').trim();

    const buildQrEmailPngUrl = () => {
      if (!bucket || !region || !eventId) return '';
      return `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/email_png/${eventId}/${guest._id}.png`;
    };

    const fallback = guest.qrCode?.includes('.png')
      ? guest.qrCode
      : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`;

    let qrCodeUrl: string;
    if (normalizedTemplate === 'rsvp_form') {
      qrCodeUrl = extras?.formLinkPath || ' ';
    } else if (normalizedTemplate === 'rsvp_followup' || normalizedTemplate === 'wedding_invite') {
      qrCodeUrl = buildQrEmailPngUrl() || guest.pngUrl || fallback;
    } else {
      qrCodeUrl = guest.pngUrl || fallback;
    }

    // Delegate all template parameter building to the external helper.
    // The helper now correctly handles the 9‑variable wedding_invite,
    // including placing event.iv into variable 8.
    let dbDefinitions = null as any;
    try {
      const { WhatsAppContentTemplate } = await import(
        '../models/WhatsAppContentTemplate.js'
      );
      const dbDoc = await (WhatsAppContentTemplate as any)
        .findOne({ friendlyName: templateName, approvalStatus: 'approved' })
        .select({ variableDefinitions: 1 })
        .lean();
      dbDefinitions = Array.isArray(dbDoc?.variableDefinitions)
        ? dbDoc.variableDefinitions
        : null;
    } catch {
      /* ignore - best-effort DB template lookup */
    }

    const templateParams = buildWhatsAppTemplateParams({
      templateName,
      recipientName: guest.fullname,
      eventName: eventData.name,
      location: (eventData as any).location || (eventData as any).venue || 'TBA',
      eventDate: eventData.date || 'TBA',
      passUrl: qrCodeUrl,
      eventIv: eventData.iv || null,
      signoff: templateVariables?.["3"] || undefined, // optional, can be overridden later
      templateVariables: templateVariables || undefined,
      customDefinition: dbDefinitions,
    });

    // For wedding_invite, the image URL is already inside the body as variable 8.
    // Do NOT send a separate header image.
    const mediaUrl = normalizedTemplate === 'wedding_invite' ? null : null;

    return { templateParams, mediaUrl };
  }

  async updateMessageStatus(
    providerMessageId: string,
    status: string,
    timestamp?: number,
    errorMessage?: string
  ): Promise<boolean> {
    try {
      const normalizedStatus =
        status === 'undelivered'
          ? 'failed'
          : status === 'received'
            ? 'sent'
            : status;
      const updateData: any = { status: normalizedStatus };
      
      if (timestamp) {
        if (normalizedStatus === 'delivered') updateData.deliveredAt = new Date(timestamp * 1000);
        if (normalizedStatus === 'read') updateData.readAt = new Date(timestamp * 1000);
      }

      if (errorMessage && normalizedStatus === 'failed') {
        updateData.errorMessage = errorMessage;
      }

      await WhatsAppMessage.findOneAndUpdate(
        { providerMessageId },
        updateData
      );

      return true;
    } catch (error) {
      console.error('Status update error:', error);
      return false;
    }
  }

  async getMessageStats(eventId: string) {
    const stats = await WhatsAppMessage.aggregate([
      { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      not_on_whatsapp: 0
    };

    stats.forEach((stat: any) => {
      result[stat._id as keyof typeof result] = stat.count;
      result.total += stat.count;
    });

    return result;
  }
}

export default new WhatsAppService();