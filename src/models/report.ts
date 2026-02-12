import { Schema, model, Document, Types } from "mongoose";

export interface ReportDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  type: "pdf" | "excel" | "csv";
  fileUrl: string;
  status: "pending" | "ready" | "failed";
  createdBy?: Types.ObjectId;
  shareToken?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<ReportDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    type: { type: String, enum: ["pdf", "excel", "csv"], required: true },
    fileUrl: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "ready", "failed"],
      default: "pending",
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    shareToken: { type: String, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ReportSchema.index({ eventId: 1, createdAt: -1 });
ReportSchema.index({ shareToken: 1 });

export const Report = model<ReportDocument>("Report", ReportSchema);
