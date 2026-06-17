import { Schema, model } from "mongoose";
const MessageScheduleSchema = new Schema({
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
    templateId: { type: Schema.Types.ObjectId, default: null },
    servicePackage: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    errorMessage: { type: String, default: null },
}, { timestamps: true });
MessageScheduleSchema.index({ eventId: 1, scheduledDate: 1 });
export const MessageSchedule = model("MessageSchedule", MessageScheduleSchema);
