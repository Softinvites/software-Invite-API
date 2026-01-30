import { Schema, model, Document, Types } from "mongoose";

export interface RSVPFormLinkDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  token: string;
  submitted: boolean;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RSVPFormLinkSchema = new Schema<RSVPFormLinkDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    token: { type: String, required: true, unique: true, index: true },
    submitted: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

RSVPFormLinkSchema.index({ eventId: 1 });

export const RSVPFormLink = model<RSVPFormLinkDocument>(
  "RSVPFormLink",
  RSVPFormLinkSchema,
);
