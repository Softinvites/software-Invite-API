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
