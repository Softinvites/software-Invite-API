"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
async function run() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/softinvites';
    await mongoose_1.default.connect(uri);
    const db = mongoose_1.default.connection.db;
    const events = await db.collection('events').find({}, { projection: { date: 1, name: 1 } }).sort({ date: -1 }).limit(20).toArray();
    console.log('Sample events (id, date, name):');
    events.forEach((e) => console.log(e._id, e.date, e.name));
    await mongoose_1.default.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
