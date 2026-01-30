import { Schema, model, Document, Types } from "mongoose";

export interface RSVPField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "radio" | "checkbox" | "number";
  required?: boolean;
  options?: string[];
}

export interface RSVPFormDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  fields: RSVPField[];
  allowUpdates: boolean;
  enableNameValidation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RSVPFormSchema = new Schema<RSVPFormDocument>(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    fields: {
      type: [
        {
          name: { type: String, required: true },
          label: { type: String, required: true },
          type: {
            type: String,
            enum: ["text", "textarea", "select", "radio", "checkbox", "number"],
            required: true,
          },
          required: { type: Boolean, default: false },
          options: { type: [String], default: [] },
        },
      ],
      default: [],
    },
    allowUpdates: { type: Boolean, default: true },
    enableNameValidation: { type: Boolean, default: true },
  },
  { timestamps: true },
);

RSVPFormSchema.index({ eventId: 1 }, { unique: true });

export const RSVPForm = model<RSVPFormDocument>("RSVPForm", RSVPFormSchema);
