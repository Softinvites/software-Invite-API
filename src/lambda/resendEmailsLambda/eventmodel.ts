import { Schema, model, Document } from "mongoose";

interface EventDocument extends Document {
  name: string;
  date: string;
  location: string;
  description: string;
  iv: string;
  emailSenderMode?: "softinvites" | "event" | "custom";
  emailSenderName?: string;
  isActive: boolean;
}

const EventSchema = new Schema({
  name: { type: String, required: true },
  date: { type: String, required: true },
  location: { type: String, required: true },
  description: { type: String, required: true, trim: true, maxlength: 3000 },
  iv: { type: String, required: false }, 
  emailSenderMode: {
    type: String,
    enum: ["softinvites", "event", "custom"],
    default: "softinvites",
  },
  emailSenderName: { type: String, default: "", trim: true, maxlength: 70 },
  isActive: { type: Boolean, default: true },
},

{
    timestamps: true,
  }

);

export const Event = model<EventDocument>("Event", EventSchema);