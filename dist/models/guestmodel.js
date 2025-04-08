"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Guest = void 0;
const mongoose_1 = require("mongoose");
const GuestSchema = new mongoose_1.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    qrCode: { type: String, required: true },
    qrCodeBgColor: { type: String, default: "255,255,255" },
    qrCodeCenterColor: { type: String, default: "0,0,0" },
    qrCodeEdgeColor: { type: String, default: "0,0,0" },
    eventId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Event", required: true },
    status: {
        type: String,
        enum: ["pending", "checked-in"],
        default: "pending",
    },
    checkedIn: { type: Boolean, default: false },
    imported: { type: Boolean, default: false },
}, { timestamps: true });
exports.Guest = (0, mongoose_1.model)("Guest", GuestSchema);
