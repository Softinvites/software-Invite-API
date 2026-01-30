import { Schema, model, Document, Types } from "mongoose";

export interface RSVPDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  guestName: string;
  email?: string;
  phone?: string;
  attendanceStatus: "pending" | "yes" | "no";
  comments?: string;
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
    guestName: { type: String, required: true },
    email: { type: String, required: false },
    phone: { type: String, required: false },
    attendanceStatus: {
      type: String,
      enum: ["pending", "yes", "no"],
      default: "pending",
      index: true,
    },
    comments: { type: String, default: "" },
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

export const RSVP = model<RSVPDocument>("RSVP", RSVPSchema);
