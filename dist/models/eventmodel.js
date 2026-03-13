"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Event = void 0;
const mongoose_1 = require("mongoose");
const EventSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    date: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    iv: { type: String, required: false },
    rsvpMessage: { type: String, required: false },
    rsvpBgColor: { type: String, required: false },
    rsvpAccentColor: { type: String, required: false },
    rsvpFormSettings: { type: mongoose_1.Schema.Types.Mixed, default: null },
    servicePackage: {
        type: String,
        enum: ["invitation-only", "one-time-rsvp", "standard-rsvp", "full-rsvp"],
        default: "standard-rsvp",
    },
    messageCycle: { type: Number, min: 0, max: 7, default: 3 },
    channelConfig: {
        email: {
            enabled: { type: Boolean, default: true },
            required: { type: Boolean, default: true },
            replyTo: { type: String, default: null },
            trackingEnabled: { type: Boolean, default: true },
        },
        whatsapp: {
            enabled: { type: Boolean, default: false },
            businessAccountId: { type: String, default: null },
            apiKey: { type: String, default: null },
            optInRequired: { type: Boolean, default: true },
        },
        bulkSms: {
            enabled: { type: Boolean, default: false },
            provider: { type: String, default: null },
            senderId: { type: String, default: null },
            optInRequired: { type: Boolean, default: true },
        },
    },
    customMessageSequence: [
        {
            dayOffset: { type: Number, default: null },
            scheduledDate: { type: Date, default: null },
            messageName: { type: String, default: "" },
            messageTitle: { type: String, default: "" },
            messageBody: { type: String, default: "" },
            includeResponseButtons: { type: Boolean, default: true },
            attachment: {
                url: { type: String, default: null },
                filename: { type: String, default: null },
                contentType: { type: String, default: null },
            },
            channels: {
                email: {
                    enabled: { type: Boolean, default: true },
                    templateId: { type: mongoose_1.Schema.Types.ObjectId, default: null },
                },
                whatsapp: {
                    enabled: { type: Boolean, default: false },
                    templateId: { type: mongoose_1.Schema.Types.ObjectId, default: null },
                },
                bulkSms: {
                    enabled: { type: Boolean, default: false },
                    templateId: { type: mongoose_1.Schema.Types.ObjectId, default: null },
                },
            },
            conditions: {
                audienceType: {
                    type: String,
                    enum: [
                        "all",
                        "responders",
                        "non-responders",
                        "yes",
                        "no",
                        "pending",
                        "pending-and-no",
                    ],
                    default: "all",
                },
                delayAfterPrevious: { type: Number, default: 0 },
                sendWindow: {
                    start: { type: String, default: null },
                    end: { type: String, default: null },
                },
            },
            trackingId: { type: String, default: null },
        },
    ],
    rsvpDeadline: { type: Date, default: null },
    eventEndDate: { type: Date, default: null },
    channelAnalytics: {
        emailOpenRate: { type: Number, default: 0 },
        whatsappDeliveryRate: { type: Number, default: 0 },
        smsDeliveryRate: { type: Number, default: 0 },
        responseRateByChannel: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    },
    isActive: { type: Boolean, default: true },
    eventStatus: { type: String, enum: ["active", "expired"], required: false }, // Optional field
}, {
    timestamps: true,
});
// Method to check if event is expired (2 days after event date)
EventSchema.methods.getEventStatus = function () {
    const eventDate = new Date(this.date);
    const expirationDate = new Date(eventDate.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days after
    const now = new Date();
    return now > expirationDate ? "expired" : "active";
};
// Update eventStatus before save (optional)
EventSchema.pre("save", function () {
    const eventDate = new Date(this.date);
    const expirationDate = new Date(eventDate.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days after
    const now = new Date();
    this.eventStatus = now > expirationDate ? "expired" : "active";
});
exports.Event = (0, mongoose_1.model)("Event", EventSchema);
