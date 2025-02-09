import { Schema, model, Document, Types } from "mongoose";

interface GuestDocument extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  qrCode: string;
  qrCodeColor: "black" | "blue";
  event: Types.ObjectId;
  status: "pending" | "checked-in";
  imported: boolean;
  createdAt: Date;
  updatedAt: Date;
  checkedIn: boolean; // Add this field
}

const GuestSchema = new Schema<GuestDocument>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    qrCode: { type: String, required: true },
    qrCodeColor: { type: String, enum: ["black", "blue"], default: "black" },
    event: { type: Schema.Types.ObjectId, ref: "Event", required: true },
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
