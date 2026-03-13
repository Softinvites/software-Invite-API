import { Schema, model, Document, Types } from "mongoose";

export interface RSVPChannelPreferenceDocument extends Document {
  _id: Types.ObjectId;
  rsvpId: Types.ObjectId;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
}

const RSVPChannelPreferenceSchema = new Schema<RSVPChannelPreferenceDocument>(
  {
    rsvpId: { type: Schema.Types.ObjectId, ref: "RSVP", required: true },
    whatsappOptIn: { type: Boolean, default: false },
    smsOptIn: { type: Boolean, default: false },
  },
  { strict: false, timestamps: true },
);

RSVPChannelPreferenceSchema.index({ rsvpId: 1 });

export const RSVPChannelPreference = model<RSVPChannelPreferenceDocument>(
  "RSVPChannelPreference",
  RSVPChannelPreferenceSchema,
);
