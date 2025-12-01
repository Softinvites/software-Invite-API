import { Schema, model, Document } from "mongoose";

interface EventDocument extends Document {
  name: string;
  date: string;
  location: string;
  description: string;
  iv: string;
  isActive: boolean;
  eventStatus?: "active" | "expired"; // Optional to avoid conflicts with existing data
  getEventStatus(): "active" | "expired";
}

const EventSchema = new Schema(
  {
    name: { type: String, required: true },
    date: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    iv: { type: String, required: false },
    isActive: { type: Boolean, default: true },
    eventStatus: { type: String, enum: ["active", "expired"], required: false }, // Optional field
  },
  {
    timestamps: true,
  }
);

// Method to check if event is expired (2 days after event date)
EventSchema.methods.getEventStatus = function () {
  const eventDate = new Date(this.date);
  const expirationDate = new Date(
    eventDate.getTime() + 2 * 24 * 60 * 60 * 1000
  ); // 2 days after
  const now = new Date()

  return now > expirationDate ? "expired" : "active";
};

// Update eventStatus before save (optional)
EventSchema.pre("save", function () {
  const eventDate = new Date(this.date);
  const expirationDate = new Date(
    eventDate.getTime() + 2 * 24 * 60 * 60 * 1000
  ); // 2 days after
  const now = new Date();

  this.eventStatus = now > expirationDate ? "expired" : "active";
});

export const Event = model<EventDocument>("Event", EventSchema);
