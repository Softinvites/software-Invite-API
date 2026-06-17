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
      unique: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    provider: {
      type: String,
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
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

export const WhatsAppTemplate =
  mongoose.models.WhatsAppTemplate ||
  mongoose.model("WhatsAppTemplate", whatsAppTemplateSchema);
