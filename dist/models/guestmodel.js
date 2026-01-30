"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Guest = void 0;
const mongoose_1 = require("mongoose");
const GuestSchema = new mongoose_1.Schema({
    fullname: { type: String, required: true },
    normalizedFullname: { type: String, required: true },
    TableNo: { type: String, required: false },
    email: { type: String, required: false },
    phone: { type: String, required: false },
    message: { type: String, required: true },
    others: { type: String, required: false },
    qrCode: { type: String, required: false },
    pngUrl: { type: String, required: false },
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
// Strict duplicate guard using normalized name (trim + lowercase + single spaces)
GuestSchema.index({ eventId: 1, normalizedFullname: 1 }, {
    unique: true,
    partialFilterExpression: { normalizedFullname: { $exists: true } },
});
function normalizeName(value) {
    return (value || "").trim().replace(/\s+/g, " ").toLowerCase();
}
// Ensure normalized name is always set on save
GuestSchema.pre("save", function (next) {
    this.fullname = this.fullname?.trim().replace(/\s+/g, " ");
    this.normalizedFullname = normalizeName(this.fullname);
    next();
});
// Apply normalized name for findOneAndUpdate updates
GuestSchema.pre("findOneAndUpdate", function (next) {
    const update = this.getUpdate() || {};
    const nextName = update.fullname ?? update.$set?.fullname;
    if (nextName !== undefined) {
        const cleaned = String(nextName).trim().replace(/\s+/g, " ");
        const normalized = normalizeName(cleaned);
        if (update.fullname !== undefined)
            update.fullname = cleaned;
        update.$set = update.$set || {};
        update.$set.fullname = cleaned;
        update.$set.normalizedFullname = normalized;
        this.setUpdate(update);
    }
    next();
});
// Apply normalized name on bulk inserts (e.g., CSV import)
GuestSchema.pre("insertMany", function (next, docs) {
    docs.forEach((doc) => {
        doc.fullname = doc.fullname?.trim().replace(/\s+/g, " ");
        doc.normalizedFullname = normalizeName(doc.fullname);
    });
    next();
});
exports.Guest = (0, mongoose_1.model)("Guest", GuestSchema);
