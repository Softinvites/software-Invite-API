import mongoose from 'mongoose';

const whatsAppMessageSchema = new mongoose.Schema({
  guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest', required: false, default: null },
  rsvpId: { type: mongoose.Schema.Types.ObjectId, ref: 'RSVP', required: false, default: null },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  templateName: { type: String, required: true },
  status: {
    type: String,
    enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'not_on_whatsapp'],
    default: 'queued',
  },
  providerMessageId: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  errorMessage: { type: String },
  sentAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date },
  readAt: { type: Date },
}, { timestamps: true });

whatsAppMessageSchema.index({ eventId: 1, status: 1 });
whatsAppMessageSchema.index({ providerMessageId: 1 });

export const WhatsAppMessage = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);
