import mongoose from "mongoose";

const whatsAppTemplateSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: false,
    },
    name: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    provider: {
      type: String,
      enum: ["meta", "twilio", "termii", null],
      default: null,
    },
    contentSid: {
      type: String,
      default: null,
    },
    statusCallbackUrl: {
      type: String,
      default: null,
    },
    language: {
      type: String,
      default: "en_US",
    },
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      default: "UTILITY",
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "pending", "approved", "rejected"],
      default: "APPROVED",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

whatsAppTemplateSchema.index({ eventId: 1, name: 1 }, { unique: true });

export const WhatsAppTemplate =
  mongoose.models.WhatsAppTemplate ||
  mongoose.model("WhatsAppTemplate", whatsAppTemplateSchema);
