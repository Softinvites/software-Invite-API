import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGO_DB || process.env.MONGOURL || 'mongodb://localhost:27017/softinvites';

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

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

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
