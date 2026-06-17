import { Schema, model, Document, Types } from "mongoose";

export interface RSVPFormLinkDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  token: string;
  slug?: string;
  redirectUrl?: string | null;
  submitted: boolean;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RSVPFormLinkSchema = new Schema<RSVPFormLinkDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    token: { type: String, required: true, unique: true, index: true },
    slug: { type: String, default: null },
    redirectUrl: { type: String, default: null },
    submitted: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const RSVPFormLink = model<RSVPFormLinkDocument>(
  "RSVPFormLink",
  RSVPFormLinkSchema,
);
