import { Schema, model } from "mongoose";
const RSVPSchema = new Schema({
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
}, { strict: false, timestamps: true });
RSVPSchema.index({ eventId: 1, attendanceStatus: 1 });
export const RSVP = model("RSVP", RSVPSchema);
