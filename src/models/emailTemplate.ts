import { Schema, model, Document, Types } from "mongoose";

export interface EmailTemplateDocument extends Document {
  _id: Types.ObjectId;
  eventId?: Types.ObjectId;
  name: string;
  subject: string;
  html: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema = new Schema<EmailTemplateDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", default: null },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
  },
  { timestamps: true },
);

EmailTemplateSchema.index({ eventId: 1, name: 1 });

export const EmailTemplate = model<EmailTemplateDocument>(
  "EmailTemplate",
  EmailTemplateSchema,
);
