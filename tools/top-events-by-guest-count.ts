import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/softinvites';
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  const agg = await db.collection('guests').aggregate([
    { $group: { _id: '$eventId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
    { $lookup: { from: 'events', localField: '_id', foreignField: '_id', as: 'event' } },
    { $unwind: { path: '$event', preserveNullAndEmptyArrays: true } },
    { $project: { eventId: '$_id', count: 1, 'event.date': 1, 'event.name': 1 } }
  ]).toArray();

  console.log('Top events by guest count:');
  agg.forEach((r: any) => console.log(r.eventId, r.count, r.event?.date, r.event?.name));

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
