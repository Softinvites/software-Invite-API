import { Schema, model } from "mongoose";
const RSVPChannelPreferenceSchema = new Schema({
    rsvpId: { type: Schema.Types.ObjectId, ref: "RSVP", required: true },
    whatsappOptIn: { type: Boolean, default: false },
    smsOptIn: { type: Boolean, default: false },
}, { strict: false, timestamps: true });
RSVPChannelPreferenceSchema.index({ rsvpId: 1 });
export const RSVPChannelPreference = model("RSVPChannelPreference", RSVPChannelPreferenceSchema);
