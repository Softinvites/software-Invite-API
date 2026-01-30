#!/usr/bin/env ts-node
import mongoose from "mongoose";
import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Guest } from "../src/models/guestmodel";
import { RSVP } from "../src/models/rsvpmodel";
import { generateRsvpToken } from "../src/utils/rsvpToken";

dotenv.config();

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGO_URL ||
  "mongodb://localhost:27017/softinvites";

const argv = yargs(hideBin(process.argv))
  .option("eventId", { type: "string", describe: "Restrict to an event" })
  .option("dryRun", { type: "boolean", default: false })
  .help()
  .parseSync();

async function main() {
  await mongoose.connect(MONGO_URI, {
    dbName: process.env.MONGO_DB || undefined,
  });
  console.log("Connected to Mongo");

  const match: any = {}; // base query
  if (argv.eventId) {
    match.eventId = new mongoose.Types.ObjectId(argv.eventId);
  }

  const guests = await Guest.find({
    ...match,
    rsvpToken: { $in: [null, undefined] },
  });
  console.log(
    `Found ${guests.length} guests missing rsvpToken${argv.eventId ? " for event " + argv.eventId : ""}`,
  );

  let created = 0;
  for (const guest of guests) {
    const token = generateRsvpToken();
    guest.rsvpToken = token;
    guest.rsvpStatus = guest.rsvpStatus || "pending";

    if (!argv.dryRun) {
      await guest.save();
      await RSVP.updateOne(
        { guestId: guest._id, eventId: guest.eventId },
        {
          $setOnInsert: {
            token,
            status: "pending",
            responses: {},
            respondedAt: null,
          },
          $set: { token },
        },
        { upsert: true },
      );
    }
    created += 1;
  }

  console.log(
    `${argv.dryRun ? "(dry-run) would set" : "Set"} tokens for ${created} guests`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
