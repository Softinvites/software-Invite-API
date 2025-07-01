"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloadTask = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const DownloadTaskSchema = new mongoose_1.default.Schema({
    eventId: { type: String, required: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    downloadLink: { type: String },
    error: { type: String },
    createdAt: { type: Date, default: Date.now },
});
exports.DownloadTask = mongoose_1.default.model('DownloadTask', DownloadTaskSchema);
