import mongoose from 'mongoose';

const whatsAppTemplateSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: false
  },
  name: {
    type: String,
    required: true,
    unique: true
  },
  displayName: {
    type: String,
    required: true
  },
  language: {
    type: String,
    default: 'en_US'
  },
  category: {
    type: String,
    enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'],
    default: 'UTILITY'
  },
  components: [{
    type: {
      type: String,
      enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS']
    },
    format: String,
    text: String,
    parameters: [String]
  }],
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'pending', 'approved', 'rejected'],
    default: 'APPROVED'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

export const WhatsAppTemplate = mongoose.model('WhatsAppTemplate', whatsAppTemplateSchema);
