import { Schema, model, Document, Types } from "mongoose";

export interface RSVPDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  guestName: string;
  email?: string | null;
  phone?: string | null;
  attendanceStatus: "pending" | "yes" | "no";
}

const RSVPSchema = new Schema<RSVPDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    guestName: { type: String, required: true },
    email: { type: String, default: null },
    phone: { type: String, default: null },
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
