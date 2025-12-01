"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Guest = void 0;
const mongoose_1 = require("mongoose");
const GuestSchema = new mongoose_1.Schema({
    fullname: { type: String, required: true },
    TableNo: { type: String, required: false },
    email: { type: String, required: false, },
    phone: { type: String, required: false },
    message: { type: String, required: true },
    others: { type: String, required: false },
    qrCode: { type: String, required: false },
    qrCodeData: { type: String, required: false },
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
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: String, default: null },
    imported: { type: Boolean, default: false },
}, { timestamps: true });
exports.Guest = (0, mongoose_1.model)("Guest", GuestSchema);
