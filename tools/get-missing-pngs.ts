import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/softinvites';

import { Guest } from '../src/models/guestmodel';

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { eventId?: string } = {};
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

  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined });

  const cursor = Guest.find({ eventId, $or: [{ pngUrl: { $exists: false } }, { pngUrl: null }, { pngUrl: '' }] })
    .select('_id')
    .cursor();

  for await (const doc of cursor) {
    console.log(doc._id.toString());
  }

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
