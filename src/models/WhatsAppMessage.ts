import mongoose from 'mongoose';

const whatsAppMessageSchema = new mongoose.Schema({
  guestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    required: false,
    default: null,
  },
  // RSVP-admin sends (full-rsvp service package) use the RSVP collection
  // instead of Guest. Storing the rsvpId here lets the status dashboard
  // resolve guest names for both send paths uniformly.
  rsvpId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RSVP',
    required: false,
    default: null,
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
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppTemplate',
    required: false
  },
  status: {
    type: String,
    enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'not_on_whatsapp'],
    default: 'queued'
  },
  providerMessageId: {
    type: String,
    required: true
  },
  whatsappMessageId: {
    type: String,
    required: false
  },
  phoneNumber: {
    type: String,
    required: true
  },
  fallbackChannel: {
    type: String,
    default: 'email'
  },
  cost: {
    type: Number,
    default: 0
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
  },
  // SMS backup sent after this WhatsApp message failed (sent at most once).
  smsFallbackAt: { type: Date, default: null },
  smsFallbackStatus: { type: String, default: null },
  smsFallbackError: { type: String, default: null }
}, {
  timestamps: true
});

whatsAppMessageSchema.index({ eventId: 1, status: 1 });
whatsAppMessageSchema.index({ guestId: 1 });
whatsAppMessageSchema.index({ rsvpId: 1 });
whatsAppMessageSchema.index({ providerMessageId: 1 });

export const WhatsAppMessage = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
