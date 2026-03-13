import { Schema, model, Document, Types } from "mongoose";

export interface EmailTemplateDocument extends Document {
  _id: Types.ObjectId;
  eventId?: Types.ObjectId | null;
  name?: string | null;
  subject?: string | null;
  html?: string | null;
}

const EmailTemplateSchema = new Schema<EmailTemplateDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", default: null },
    name: { type: String, default: null },
    subject: { type: String, default: null },
    html: { type: String, default: null },
  },
  { strict: false, timestamps: true },
);

EmailTemplateSchema.index({ eventId: 1, name: 1 });

export const EmailTemplate = model<EmailTemplateDocument>(
  "EmailTemplate",
  EmailTemplateSchema,
);
