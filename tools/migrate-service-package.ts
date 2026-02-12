import mongoose from "mongoose";
import { Event } from "../src/models/eventmodel";

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGO_URI not configured");
  }
  await mongoose.connect(uri);

  const events = await Event.find({});
  for (const event of events) {
    let dirty = false;
    if (!event.servicePackage) {
      (event as any).servicePackage = "standard-rsvp";
      dirty = true;
    }
    if (!(event as any).channelConfig) {
      (event as any).channelConfig = {
        email: { enabled: true, required: true, trackingEnabled: true },
        whatsapp: { enabled: false, optInRequired: true },
        bulkSms: { enabled: false, optInRequired: true },
      };
      dirty = true;
    }
    if ((event as any).messageCycle === undefined) {
      (event as any).messageCycle = 3;
      dirty = true;
    }
    if (dirty) {
      await event.save();
    }
  }

  console.log(`Migrated ${events.length} events`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
