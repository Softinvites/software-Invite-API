import { Schema, model, Document, Types } from "mongoose";

interface GuestDocument extends Document {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  qrCode: string;
  qrCodeData: string;
  qrCodeBgColor: string;
  qrCodeCenterColor: string;
  qrCodeEdgeColor: string;
  eventId: Types.ObjectId;
  status: "pending" | "checked-in";
  imported: boolean;
  createdAt: Date;
  updatedAt: Date;
  checkedIn: boolean;
}

const GuestSchema = new Schema<GuestDocument>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: false, },
    phone: { type: String, required: false },
    qrCode: { type: String, required: false },
    qrCodeData: { type: String, required: false },
    qrCodeBgColor: { type: String, default: "255,255,255" }, 
    qrCodeCenterColor: { type: String, default: "0,0,0" }, 
    qrCodeEdgeColor: { type: String, default: "0,0,0" },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    status: {
      type: String,
      enum: ["pending", "checked-in"],
      default: "pending",
    },
    checkedIn: { type: Boolean, default: false },
    imported: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Guest = model<GuestDocument>("Guest", GuestSchema);
