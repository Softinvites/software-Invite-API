import { Schema, model, Document, Types } from "mongoose";

export interface EmailMessageDocument extends Document {
  _id: Types.ObjectId;
  trackingId: string;
  eventId?: Types.ObjectId;
  rsvpId?: Types.ObjectId;
  guestEmail: string;
  subject?: string;
  messageType?: string;
  channel: "email";
  status: "pending" | "sent" | "failed";
  sentAt?: Date;
  openCount: number;
  clickCount: number;
  lastOpenAt?: Date;
  lastClickAt?: Date;
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
    sentAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    lastOpenAt: { type: Date, default: null },
    lastClickAt: { type: Date, default: null },
  },
  { timestamps: true },
);

EmailMessageSchema.index({ eventId: 1, createdAt: -1 });

export const EmailMessage = model<EmailMessageDocument>(
  "EmailMessage",
  EmailMessageSchema,
);
