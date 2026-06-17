import { Schema, model } from "mongoose";
const EmailTemplateSchema = new Schema({
    eventId: { type: Schema.Types.ObjectId, ref: "Event", default: null },
    name: { type: String, default: null },
    subject: { type: String, default: null },
    html: { type: String, default: null },
}, { strict: false, timestamps: true });
EmailTemplateSchema.index({ eventId: 1, name: 1 });
export const EmailTemplate = model("EmailTemplate", EmailTemplateSchema);
