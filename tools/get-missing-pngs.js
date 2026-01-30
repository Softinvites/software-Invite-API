"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
dotenv_1.default.config();
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/softinvites';
const guestmodel_1 = require("../src/models/guestmodel");
function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--eventId' && args[i + 1]) {
            out.eventId = args[i + 1];
            i++;
        }
    }
    return out;
}
async function run() {
    const { eventId } = parseArgs();
    if (!eventId) {
        console.error('Usage: --eventId <id>');
        process.exit(2);
    }
    await mongoose_1.default.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined });
    const cursor = guestmodel_1.Guest.find({ eventId, $or: [{ pngUrl: { $exists: false } }, { pngUrl: null }, { pngUrl: '' }] })
        .select('_id')
        .cursor();
    for await (const doc of cursor) {
        console.log(doc._id.toString());
    }
    await mongoose_1.default.disconnect();
}
run().catch((e) => {
    console.error(e);
    process.exit(1);
});
