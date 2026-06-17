import { Schema, model, Document, Types } from "mongoose";

export interface MessageScheduleDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  messageType: "initial" | "reminder" | "thankyou" | "custom";
  messageName?: string | null;
  messageTitle?: string | null;
  messageBody?: string | null;
  includeResponseButtons?: boolean | null;
  attachment?: {
    url?: string | null;
    filename?: string | null;
    contentType?: string | null;
  } | null;
  scheduledDate: Date;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  targetAudience:
    | "all"
    | "non-responders"
    | "responders"
    | "yes"
    | "no"
    | "pending"
    | "pending-and-no"
    | "tag";
  targetTag?: string | null;
  channel: "email" | "whatsapp" | "bulkSms";
  // String so it can hold either a Mongo ObjectId (legacy per-event template)
  // or a friendlyName like "rsvp_stalo" from the Content Template Manager.
  templateId?: string | null;
  templateVariables?: Record<string, any> | null;
  redirectUrl?: string | null;
  servicePackage?: string | null;
  attempts: number;
  lastAttemptAt?: Date | null;
  errorMessage?: string | null;
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
      enum: ["pending", "processing", "sent", "failed", "cancelled"],
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
        "tag",
      ],
      default: "all",
    },
    targetTag: { type: String, default: null },
    channel: {
      type: String,
      enum: ["email", "whatsapp", "bulkSms"],
      default: "email",
    },
    templateId: { type: String, default: null },
    templateVariables: { type: Schema.Types.Mixed, default: null },
    redirectUrl: { type: String, default: null },
    servicePackage: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true },
);

MessageScheduleSchema.index({ eventId: 1, scheduledDate: 1 });

export const MessageSchedule = model<MessageScheduleDocument>(
  "MessageSchedule",
  MessageScheduleSchema,
);
