"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Event = void 0;
const mongoose_1 = require("mongoose");
const EventSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    date: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    isActive: { type: Boolean, default: true },
}, {
    timestamps: true,
});
exports.Event = (0, mongoose_1.model)("Event", EventSchema);
