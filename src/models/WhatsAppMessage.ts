import mongoose from 'mongoose';

const whatsAppMessageSchema = new mongoose.Schema({
  guestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    required: true
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  templateName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed', 'not_on_whatsapp'],
    default: 'sent'
  },
  providerMessageId: {
    type: String,
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  errorMessage: {
    type: String
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  deliveredAt: {
    type: Date
  },
  readAt: {
    type: Date
  }
}, {
  timestamps: true
});

whatsAppMessageSchema.index({ eventId: 1, status: 1 });
whatsAppMessageSchema.index({ guestId: 1 });
whatsAppMessageSchema.index({ providerMessageId: 1 });

export const WhatsAppMessage = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);