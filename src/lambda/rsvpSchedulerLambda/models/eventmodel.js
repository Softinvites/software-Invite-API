import { Schema, model } from "mongoose";
const EventSchema = new Schema({
    name: { type: String, required: true },
    date: { type: String, required: false },
    description: { type: String, required: false },
    location: { type: String, required: false },
    iv: { type: String, required: false },
    rsvpMessage: { type: String, required: false },
    rsvpBgColor: { type: String, required: false },
    rsvpAccentColor: { type: String, required: false },
    qrCodeBgColor: { type: String, required: false },
    qrCodeCenterColor: { type: String, required: false },
    rsvpFormSettings: { type: Schema.Types.Mixed, default: null },
    channelConfig: {
        email: {
            enabled: { type: Boolean, default: true },
            replyTo: { type: String, default: null },
        },
        whatsapp: {
            enabled: { type: Boolean, default: false },
        },
        bulkSms: {
            enabled: { type: Boolean, default: false },
        },
    },
}, { strict: false, timestamps: true });
export const Event = model("Event", EventSchema);
