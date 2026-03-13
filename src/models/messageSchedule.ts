import { Schema, model, Document, Types } from "mongoose";

export interface MessageScheduleDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  messageType: "initial" | "reminder" | "thankyou" | "custom";
  messageName?: string;
  messageTitle?: string;
  messageBody?: string;
  includeResponseButtons?: boolean;
  attachment?: {
    url?: string;
    filename?: string;
    contentType?: string;
  };
  scheduledDate: Date;
  status: "pending" | "sent" | "failed" | "cancelled";
  targetAudience:
    | "all"
    | "non-responders"
    | "responders"
    | "yes"
    | "no"
    | "pending"
    | "pending-and-no";
  channel: "email" | "whatsapp" | "bulkSms";
  templateId?: Types.ObjectId;
  servicePackage?: string;
  attempts: number;
  lastAttemptAt?: Date;
  errorMessage?: string;
  emailMetadata?: {
    openRate?: number;
    clickRate?: number;
    bounceCount?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MessageScheduleSchema = new Schema<MessageScheduleDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
  messageType: {
      type: String,
      enum: ["initial", "reminder", "thankyou", "custom"],
      default: "custom",
    },
    messageName: { type: String, default: null },
    messageTitle: { type: String, default: null },
    messageBody: { type: String, default: null },
    includeResponseButtons: { type: Boolean, default: true },
    attachment: {
      url: { type: String, default: null },
      filename: { type: String, default: null },
      contentType: { type: String, default: null },
    },
    scheduledDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    targetAudience: {
      type: String,
      enum: [
        "all",
        "non-responders",
        "responders",
        "yes",
        "no",
        "pending",
        "pending-and-no",
      ],
      default: "all",
    },
    channel: {
      type: String,
      enum: ["email", "whatsapp", "bulkSms"],
      default: "email",
    },
    templateId: { type: Schema.Types.ObjectId, default: null },
    servicePackage: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
    emailMetadata: {
      openRate: { type: Number, default: 0 },
      clickRate: { type: Number, default: 0 },
      bounceCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

MessageScheduleSchema.index({ eventId: 1, scheduledDate: 1 });

export const MessageSchedule = model<MessageScheduleDocument>(
  "MessageSchedule",
  MessageScheduleSchema,
);
