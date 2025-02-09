import { Schema, model, Document } from "mongoose";

interface EventDocument extends Document {
  name: string;
  date: Date;
  location: string;
  isActive: boolean;
  guests: string[]; // Reference to guest IDs
}

const EventSchema = new Schema({
  name: { type: String, required: true },
  date: { type: Date, required: true },
  location: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  guests: [{ type: Schema.Types.ObjectId, ref: "Guest" }],
},

{
    timestamps: true,
  }

);

export const Event = model<EventDocument>("Event", EventSchema);