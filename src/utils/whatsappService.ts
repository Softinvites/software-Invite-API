import axios from 'axios';
import mongoose from 'mongoose';
import { WhatsAppMessage } from '../models/WhatsAppMessage.js';

interface Guest {
  _id: string;
  fullname: string;
  phone?: string;
  qrCode?: string;
}

interface EventData {
  _id: string;
  name: string;
  venue?: string;
  date?: string;
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

class WhatsAppService {
  private baseURL: string;
  private accessToken: string;

  constructor() {
    this.baseURL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
  }

  async sendTemplateMessage(
    phoneNumber: string, 
    templateName: string, 
    templateParams: string[], 
    guestId: string, 
    eventId: string
  ): Promise<SendResult> {
    try {
      const payload = {
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components: [
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

      const messageRecord = new WhatsAppMessage({
        guestId,
        eventId,
        templateName,
        providerMessageId: response.data.messages[0].id,
        phoneNumber,
        status: 'sent'
      });

      await messageRecord.save();

      return {
        success: true,
        messageId: response.data.messages[0].id,
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

  async sendBulkMessages(guests: Guest[], eventData: EventData, templateName: string): Promise<BulkResult> {
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
            guestIds: guests.map(g => g._id)
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

    const BATCH_SIZE = 10; // Optimized for WhatsApp Tier 1 (50 msg/sec)
    const DELAY_MS = 250;   // 250ms delay = ~40 msg/sec
    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);
      
      await Promise.allSettled(
        batch.map(async (guest) => {
          if (!guest.phone) {
            results.failed++;
            results.details.push({
              guestId: guest._id,
              name: guest.fullname,
              error: 'No phone number',
              status: 'failed'
            });
            return;
          }

          const templateParams = this.buildTemplateParams(guest, eventData);
          const result = await this.sendTemplateMessage(
            guest.phone,
            templateName,
            templateParams,
            guest._id,
            eventData._id
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

          // WhatsApp rate limiting - optimized for Tier 1
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        })
      );

      console.log(`WhatsApp batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
    }

    return results;
  }

  private buildTemplateParams(guest: Guest, eventData: EventData): string[] {
    const qrCodeUrl = guest.qrCode?.includes('.png') 
      ? guest.qrCode 
      : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`;

    return [
      guest.fullname,
      eventData.name,
      (eventData as any).location || 'TBA', // Use location instead of venue
      eventData.date || 'TBA',
      qrCodeUrl
    ];
  }

  async updateMessageStatus(providerMessageId: string, status: string, timestamp?: number): Promise<boolean> {
    try {
      const updateData: any = { status };
      
      if (timestamp) {
        if (status === 'delivered') updateData.deliveredAt = new Date(timestamp * 1000);
        if (status === 'read') updateData.readAt = new Date(timestamp * 1000);
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