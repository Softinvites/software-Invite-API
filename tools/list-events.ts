import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/softinvites';
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  const events = await db.collection('events').find({}, { projection: { date: 1, name: 1 } }).sort({ date: -1 }).limit(20).toArray();
  console.log('Sample events (id, date, name):');
  events.forEach((e: any) => console.log(e._id, e.date, e.name));

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
