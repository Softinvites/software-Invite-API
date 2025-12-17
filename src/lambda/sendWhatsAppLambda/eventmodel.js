import { Schema, model } from "mongoose";
const EventSchema = new Schema({
    name: { type: String, required: true },
    date: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    iv: { type: String, required: false },
    isActive: { type: Boolean, default: true },
}, {
    timestamps: true,
});
export const Event = model("Event", EventSchema);
