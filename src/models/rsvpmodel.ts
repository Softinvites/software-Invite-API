import { Schema, model, Document, Types } from "mongoose";
import { generateRsvpToken } from "../utils/rsvpToken";

export interface RSVPDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  guestId?: Types.ObjectId;
  token?: string;
  formLinkToken?: string;
  formResponseKey?: string;
  guestName: string;
  email?: string;
  phone?: string;
  guestCount: number;
  tag?: string;
  attendanceStatus: "pending" | "yes" | "no";
  comments?: string;
  responses?: Record<string, any>;
  submissionDate?: Date;
  source: "imported" | "form_submission";
  isEditable: boolean;
  qrCodeBgColor?: string;
  qrCodeCenterColor?: string;
  qrCodeEdgeColor?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RSVPSchema = new Schema<RSVPDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    guestId: { type: Schema.Types.ObjectId, default: () => new Types.ObjectId() },
    token: { type: String, default: () => generateRsvpToken() },
    formLinkToken: { type: String, default: null, index: true },
    formResponseKey: { type: String, default: null, index: true },
    guestName: { type: String, required: true },
    email: { type: String, required: false },
    phone: { type: String, required: false },
    guestCount: { type: Number, default: 1, min: 1 },
    tag: { type: String, default: null, index: true },
    attendanceStatus: {
      type: String,
      enum: ["pending", "yes", "no"],
      default: "pending",
      index: true,
    },
    comments: { type: String, default: "" },
    responses: { type: Schema.Types.Mixed, default: {} },
    submissionDate: { type: Date, default: null },
    source: {
      type: String,
      enum: ["imported", "form_submission"],
      required: true,
      index: true,
    },
    isEditable: { type: Boolean, default: false },
    qrCodeBgColor: { type: String, default: null },
    qrCodeCenterColor: { type: String, default: null },
    qrCodeEdgeColor: { type: String, default: null },
  },
  { timestamps: true },
);

RSVPSchema.index({ eventId: 1, email: 1 });
RSVPSchema.index({ eventId: 1, phone: 1 });
RSVPSchema.index({ eventId: 1, tag: 1 });
RSVPSchema.index({ eventId: 1, formLinkToken: 1, formResponseKey: 1, email: 1 });

export const RSVP = model<RSVPDocument>("RSVP", RSVPSchema);
