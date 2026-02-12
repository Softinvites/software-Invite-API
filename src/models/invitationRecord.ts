import { Schema, model, Document, Types } from "mongoose";

export interface InvitationRecordDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  guestName: string;
  email?: string;
  phone?: string;
  source: "imported" | "manual";
  invitationSent: boolean;
  sentCount: number;
  lastSentAt?: Date;
  lastError?: string;
  deliveryStatus: "pending" | "sent" | "failed";
  channel: "email";
  emailMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvitationRecordSchema = new Schema<InvitationRecordDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    guestName: { type: String, required: true },
    email: { type: String, required: false },
    phone: { type: String, required: false },
    source: {
      type: String,
      enum: ["imported", "manual"],
      default: "manual",
    },
    invitationSent: { type: Boolean, default: false },
    sentCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    deliveryStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    channel: { type: String, enum: ["email"], default: "email" },
    emailMessageId: { type: String, default: null },
  },
  { timestamps: true },
);

InvitationRecordSchema.index({ eventId: 1, email: 1 });
InvitationRecordSchema.index({ eventId: 1, phone: 1 });

export const InvitationRecord = model<InvitationRecordDocument>(
  "InvitationRecord",
  InvitationRecordSchema,
);
