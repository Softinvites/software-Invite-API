import { Schema, model, Document } from "mongoose";

interface EventDocument extends Document {
  name: string;
  date: string;
  location: string;
  description: string;
  iv: string;
  isActive: boolean;
  getEventStatus(): "active" | "expired";
}

const EventSchema = new Schema({
  name: { type: String, required: true },
  date: { type: String, required: true },
  location: { type: String, required: true },
  description: { type: String, required: true, trim: true, maxlength: 3000 },
  iv: { type: String, required: false },
  isActive: { type: Boolean, default: true },
},
{
  timestamps: true,
});

EventSchema.methods.getEventStatus = function () {
  const eventDate = new Date(this.date);
  const expirationDate = new Date(eventDate.getTime() + 2 * 24 * 60 * 60 * 1000);
  return new Date() > expirationDate ? "expired" : "active";
};

export const Event = model<EventDocument>("Event", EventSchema);