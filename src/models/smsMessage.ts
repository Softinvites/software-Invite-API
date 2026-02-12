import { Schema, model, Document, Types } from "mongoose";

export interface SmsMessageDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  rsvpId?: Types.ObjectId;
  to: string;
  status: "queued" | "sent" | "delivered" | "failed";
  providerMessageId?: string;
  provider?: string;
  cost?: number;
  errorMessage?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SmsMessageSchema = new Schema<SmsMessageDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    rsvpId: { type: Schema.Types.ObjectId, ref: "RSVP", default: null },
    to: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "failed"],
      default: "queued",
    },
    providerMessageId: { type: String, default: null },
    provider: { type: String, default: null },
    cost: { type: Number, default: 0 },
    errorMessage: { type: String, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

SmsMessageSchema.index({ eventId: 1, status: 1 });

export const SmsMessage = model<SmsMessageDocument>(
  "SmsMessage",
  SmsMessageSchema,
);
