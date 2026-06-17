import { Schema, model, Document, Types } from "mongoose";

export interface RSVPDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  guestName: string;
  token?: string | null;
  email?: string | null;
  phone?: string | null;
  guestCount?: number | null;
  tag?: string | null;
  attendanceStatus: "pending" | "yes" | "no";
}

const RSVPSchema = new Schema<RSVPDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    guestName: { type: String, required: true },
    token: { type: String, default: null },
    email: { type: String, default: null },
    phone: { type: String, default: null },
    guestCount: { type: Number, default: 1, min: 1 },
    tag: { type: String, default: null, index: true },
    attendanceStatus: {
      type: String,
      enum: ["pending", "yes", "no"],
      default: "pending",
      index: true,
    },
  },
  { strict: false, timestamps: true },
);

RSVPSchema.index({ eventId: 1, attendanceStatus: 1 });

export const RSVP = model<RSVPDocument>("RSVP", RSVPSchema);
