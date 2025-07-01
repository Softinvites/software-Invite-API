"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const DownloadTask_1 = require("./models/DownloadTask");
const Guest_1 = require("./models/Guest");
const processBatch_1 = require("./utils/processBatch");
const archiver_1 = __importDefault(require("archiver"));
const cloudinary_1 = __importDefault(require("./utils/cloudinary"));
const pollDownloadTasks = () => __awaiter(void 0, void 0, void 0, function* () {
    const task = yield DownloadTask_1.DownloadTask.findOneAndUpdate({ status: 'pending' }, { status: 'processing' }, { new: true });
    if (!task)
        return;
    try {
        const guests = yield Guest_1.Guest.find({ eventId: task.eventId });
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
        const uploadPromise = new Promise((resolve, reject) => {
            const uploadStream = cloudinary_1.default.uploader.upload_stream({ resource_type: 'raw', folder: 'qrcodes', format: 'zip' }, (error, result) => {
                var _a;
                if (error)
                    reject(error);
                else
                    resolve((_a = result === null || result === void 0 ? void 0 : result.secure_url) !== null && _a !== void 0 ? _a : '');
            });
            archive.pipe(uploadStream);
        });
        const batchSize = 20;
        for (let i = 0; i < guests.length; i += batchSize) {
            const batch = guests.slice(i, i + batchSize);
            const files = yield (0, processBatch_1.processBatch)(batch);
            files.forEach(file => archive.append(file.buffer, { name: file.name }));
        }
        archive.finalize();
        const downloadLink = yield uploadPromise;
        yield DownloadTask_1.DownloadTask.findByIdAndUpdate(task._id, {
            status: 'completed',
            downloadLink,
        });
    }
    catch (err) {
        console.error('Error processing QR code task:', err);
        yield DownloadTask_1.DownloadTask.findByIdAndUpdate(task._id, {
            status: 'failed',
            error: err.message,
        });
    }
});
// Poll every 5 seconds
setInterval(pollDownloadTasks, 5000);
