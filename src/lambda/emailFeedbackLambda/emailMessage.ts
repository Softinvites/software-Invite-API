import mongoose from "mongoose";
import type { Document, Types, Model } from "mongoose";

const { Schema, model, models } = mongoose;

export interface EmailMessageDocument extends Document {
  _id: Types.ObjectId;
  trackingId: string;
  eventId?: Types.ObjectId | null;
  rsvpId?: Types.ObjectId | null;
  guestEmail: string;
  subject?: string | null;
  messageType?: string | null;
  channel: "email";
  status: "pending" | "sent" | "failed";
  provider: "ses" | "sendgrid" | "smtp";
  providerMessageId?: string | null;
  deliveryStatus:
    | "pending"
    | "accepted"
    | "delivered"
    | "bounced"
    | "complained"
    | "rejected"
    | "failed";
  lastEventType?: string | null;
  lastEventAt?: Date | null;
  deliveryAttempts: number;
  acceptedAt?: Date | null;
  deliveredAt?: Date | null;
  bouncedAt?: Date | null;
  complainedAt?: Date | null;
  failureReason?: string | null;
  diagnosticContext?: Record<string, any> | null;
  diagnosticEvents?: Array<{
    type: string;
    timestamp?: Date | null;
    providerMessageId?: string | null;
    payload?: Record<string, any> | null;
  }>;
  sentAt?: Date | null;
  openCount: number;
  clickCount: number;
  lastOpenAt?: Date | null;
  lastClickAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const EmailMessageSchema = new Schema<EmailMessageDocument>(
  {
    trackingId: { type: String, required: true, unique: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", default: null },
    rsvpId: { type: Schema.Types.ObjectId, ref: "RSVP", default: null },
    guestEmail: { type: String, required: true },
    subject: { type: String, default: null },
    messageType: { type: String, default: null },
    channel: { type: String, enum: ["email"], default: "email" },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    provider: {
      type: String,
      enum: ["ses", "sendgrid", "smtp"],
      default: "ses",
    },
    providerMessageId: { type: String, default: null },
    deliveryStatus: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "delivered",
        "bounced",
        "complained",
        "rejected",
        "failed",
      ],
      default: "pending",
    },
    lastEventType: { type: String, default: null },
    lastEventAt: { type: Date, default: null },
    deliveryAttempts: { type: Number, default: 0 },
    acceptedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    bouncedAt: { type: Date, default: null },
    complainedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    diagnosticContext: { type: Schema.Types.Mixed, default: null },
    diagnosticEvents: [
      {
        type: { type: String, required: true },
        timestamp: { type: Date, default: null },
        providerMessageId: { type: String, default: null },
        payload: { type: Schema.Types.Mixed, default: null },
      },
    ],
    sentAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    lastOpenAt: { type: Date, default: null },
    lastClickAt: { type: Date, default: null },
  },
  { timestamps: true },
);

EmailMessageSchema.index({ eventId: 1, createdAt: -1 });
EmailMessageSchema.index({ providerMessageId: 1 }, { sparse: true });
EmailMessageSchema.index({ guestEmail: 1, createdAt: -1 });

export const EmailMessage =
  (models.EmailMessage as Model<EmailMessageDocument>) ||
  model<EmailMessageDocument>("EmailMessage", EmailMessageSchema);
