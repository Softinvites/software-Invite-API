import mongoose from "mongoose";
import { connectDB } from "../db";
import { RSVP } from "../models/rsvpmodel";

async function run() {
  await connectDB();

  const guestsCollection = mongoose.connection.collection("guests");
  const cursor = guestsCollection.find({
    $or: [
      { rsvpStatus: { $exists: true } },
      { rsvpRespondedAt: { $exists: true } },
      { rsvpToken: { $exists: true } },
      { guestType: "rsvp" },
    ],
  });

  let created = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const guest: any = await cursor.next();
    if (!guest) continue;

    const existing = await RSVP.findOne({
      eventId: guest.eventId,
      guestName: guest.fullname,
      email: guest.email || null,
      phone: guest.phone || null,
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await RSVP.create({
      eventId: guest.eventId,
      guestName: guest.fullname,
      email: guest.email || null,
      phone: guest.phone || null,
      attendanceStatus: guest.rsvpStatus || "pending",
      comments: "",
      submissionDate: guest.rsvpRespondedAt || null,
      source: "imported",
      isEditable: true,
      qrCodeBgColor: guest.qrCodeBgColor || null,
      qrCodeCenterColor: guest.qrCodeCenterColor || null,
      qrCodeEdgeColor: guest.qrCodeEdgeColor || null,
    });

    created += 1;
  }

  const unsetResult = await guestsCollection.updateMany(
    {
      $or: [
        { rsvpStatus: { $exists: true } },
        { rsvpRespondedAt: { $exists: true } },
        { rsvpToken: { $exists: true } },
        { rsvpSourceGuestId: { $exists: true } },
        { rsvpSourceSequence: { $exists: true } },
        { guestType: { $exists: true } },
      ],
    },
    {
      $unset: {
        rsvpStatus: "",
        rsvpRespondedAt: "",
        rsvpToken: "",
        rsvpSourceGuestId: "",
        rsvpSourceSequence: "",
        guestType: "",
      },
    },
  );

  console.log(
    `RSVP migration complete: created=${created}, skipped=${skipped}, unset=${unsetResult.modifiedCount}`,
  );

  await mongoose.connection.close();
}

run().catch((err) => {
  console.error("RSVP migration failed:", err);
  process.exit(1);
});
