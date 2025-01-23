import { Schema, model, Document } from "mongoose";

interface GuestDocument extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  qrCode: string; // Path to the generated QR code
  event: string; // Reference to event ID
}

const GuestSchema = new Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  qrCode: { type: String, required: true },
  event: { type: Schema.Types.ObjectId, ref: "Event", required: true },
});

export const Guest = model<GuestDocument>("Guest", GuestSchema);