import { Schema, model, Document } from "mongoose";

interface EventDocument extends Document {
  name: string;
  date?: string;
  description?: string;
  location?: string;
  iv?: string;
  rsvpMessage?: string;
  rsvpBgColor?: string;
  rsvpAccentColor?: string;
  emailSenderMode?: "softinvites" | "event" | "custom";
  emailSenderName?: string;
  qrCodeBgColor?: string;
  qrCodeCenterColor?: string;
  rsvpFormSettings?: Record<string, any>;
  channelConfig?: {
    email?: {
      enabled?: boolean;
      replyTo?: string;
    };
    whatsapp?: {
      enabled?: boolean;
    };
    bulkSms?: {
      enabled?: boolean;
    };
  };
}

const EventSchema = new Schema<EventDocument>(
  {
    name: { type: String, required: true },
    date: { type: String, required: false },
    description: { type: String, required: false },
    location: { type: String, required: false },
    iv: { type: String, required: false },
    rsvpMessage: { type: String, required: false },
    rsvpBgColor: { type: String, required: false },
    rsvpAccentColor: { type: String, required: false },
    emailSenderMode: {
      type: String,
      enum: ["softinvites", "event", "custom"],
      default: "softinvites",
    },
    emailSenderName: { type: String, default: "", trim: true, maxlength: 70 },
    qrCodeBgColor: { type: String, required: false },
    qrCodeCenterColor: { type: String, required: false },
    rsvpFormSettings: { type: Schema.Types.Mixed, default: null },
    channelConfig: {
      email: {
        enabled: { type: Boolean, default: true },
        replyTo: { type: String, default: null },
      },
      whatsapp: {
        enabled: { type: Boolean, default: false },
      },
      bulkSms: {
        enabled: { type: Boolean, default: false },
      },
    },
  },
  { strict: false, timestamps: true },
);

export const Event = model<EventDocument>("Event", EventSchema);
