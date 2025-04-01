import { Schema, model, Document } from "mongoose";

interface EventDocument extends Document {
  name: string;
  date: string;
  location: string;
  description: string;
  isActive: boolean;
}

const EventSchema = new Schema({
  name: { type: String, required: true },
  date: { type: String, required: true },
  location: { type: String, required: true },
  description: { type: String, required: true },
  isActive: { type: Boolean, default: true },
},

{
    timestamps: true,
  }

);

export const Event = model<EventDocument>("Event", EventSchema);