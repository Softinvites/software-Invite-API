"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
async function run() {
    const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGO_DB || process.env.MONGOURL || 'mongodb://localhost:27017/softinvites';
    await mongoose_1.default.connect(uri);
    const db = mongoose_1.default.connection.db;
    const totalGuests = await db.collection('guests').countDocuments({});
    const now = new Date();
    const activeGuestsRes = await db
        .collection('guests')
        .aggregate([
        { $lookup: { from: 'events', localField: 'eventId', foreignField: '_id', as: 'event' } },
        { $unwind: { path: '$event', preserveNullAndEmptyArrays: false } },
        { $match: { 'event.date': { $gt: now } } },
        { $count: 'count' },
    ])
        .toArray();
    const guestsInActiveEvents = activeGuestsRes[0]?.count || 0;
    const missingRes = await db
        .collection('guests')
        .aggregate([
        { $lookup: { from: 'events', localField: 'eventId', foreignField: '_id', as: 'event' } },
        { $unwind: { path: '$event', preserveNullAndEmptyArrays: false } },
        { $match: { 'event.date': { $gt: now }, $or: [{ pngUrl: { $exists: false } }, { pngUrl: null }, { pngUrl: '' }] } },
        { $count: 'count' },
    ])
        .toArray();
    const missingInActiveEvents = missingRes[0]?.count || 0;
    console.log('totalGuests:', totalGuests);
    console.log('guestsInActiveEvents:', guestsInActiveEvents);
    console.log('missingPngInActiveEvents:', missingInActiveEvents);
    await mongoose_1.default.disconnect();
}
run().catch((err) => {
    console.error(err);
    process.exit(1);
});
