import { Schema, model, Document, Types } from "mongoose";

export interface RSVPChannelPreferenceDocument extends Document {
  _id: Types.ObjectId;
  rsvpId: Types.ObjectId;
  preferredChannels: string[];
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  whatsappNumber?: string;
  mobileNumber?: string;
  optInDate?: Date;
  optOutDate?: Date;
  lastChannelUsed?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RSVPChannelPreferenceSchema = new Schema<RSVPChannelPreferenceDocument>(
  {
    rsvpId: { type: Schema.Types.ObjectId, ref: "RSVP", required: true },
    preferredChannels: { type: [String], default: ["email"] },
    whatsappOptIn: { type: Boolean, default: false },
    smsOptIn: { type: Boolean, default: false },
    whatsappNumber: { type: String, default: null },
    mobileNumber: { type: String, default: null },
    optInDate: { type: Date, default: null },
    optOutDate: { type: Date, default: null },
    lastChannelUsed: { type: String, default: null },
  },
  { timestamps: true },
);

RSVPChannelPreferenceSchema.index({ rsvpId: 1 });

export const RSVPChannelPreference = model<RSVPChannelPreferenceDocument>(
  "RSVPChannelPreference",
  RSVPChannelPreferenceSchema,
);
