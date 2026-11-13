import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import mongoose from "mongoose";
import { EmailMessage } from "./emailMessage.js";

// Bounces and rejections arrive minutes or hours after "Email Send Complete".
// This report emails the admin about new failures, grouped by event, once each.
const SETTLE_MS = 5 * 60 * 1000; // let a burst of bounces arrive together
const LOOKBACK_MS = 24 * 60 * 60 * 1000; // never report old history
const MAX_PER_RUN = 500;

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-2" });

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmt = (d?: Date | null) =>
  d ? new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) + " WAT" : "";

export const sendFailureDigest = async () => {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) return { reported: 0, skipped: "ADMIN_EMAIL not set" };

  const now = Date.now();
  const failures = (await EmailMessage.find({
    status: "failed",
    failureNotifiedAt: null,
    lastEventAt: { $gte: new Date(now - LOOKBACK_MS), $lte: new Date(now - SETTLE_MS) },
  })
    .sort({ lastEventAt: 1 })
    .limit(MAX_PER_RUN)
    .select({ eventId: 1, guestEmail: 1, deliveryStatus: 1, failureReason: 1, lastEventAt: 1, subject: 1 })
    .lean()) as any[];

  if (!failures.length) return { reported: 0 };

  const eventIds = [...new Set(failures.map((f) => String(f.eventId || "")).filter(Boolean))];
  const events = eventIds.length
    ? await mongoose.connection
        .db!.collection("events")
        .find({ _id: { $in: eventIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .project({ name: 1 })
        .toArray()
    : [];
  const nameById = new Map(events.map((e: any) => [String(e._id), e.name || "Event"]));

  const groups = new Map<string, any[]>();
  for (const f of failures) {
    const key = String(f.eventId || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const sections = [...groups.entries()]
    .map(([eventId, rows]) => {
      const title = eventId ? nameById.get(eventId) || "Unknown event" : "No event";
      const body = rows
        .map(
          (r) => `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(r.guestEmail)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(r.deliveryStatus || "failed")}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(r.failureReason || "")}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;">${esc(fmt(r.lastEventAt))}</td>
          </tr>`,
        )
        .join("");
      return `<h3 style="margin:24px 0 8px;font-size:16px;">${esc(title)} — ${rows.length} failed</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:6px 8px;">Email</th><th style="padding:6px 8px;">Status</th>
            <th style="padding:6px 8px;">Reason</th><th style="padding:6px 8px;">When</th>
          </tr>${body}</table>`;
    })
    .join("");

  const html = `<div style="font-family:Arial,sans-serif;color:#111827;max-width:760px;">
    <h2 style="margin:0 0 8px;">Email delivery failures</h2>
    <p style="margin:0 0 4px;">${failures.length} email${failures.length === 1 ? "" : "s"} could not be delivered after sending.
    You can also see these on the guest page under <b>Email Status</b>.</p>
    ${sections}
  </div>`;

  await ses.send(
    new SendEmailCommand({
      Source: process.env.EMAIL_FROM || "SoftInvites <info@softinvite.com>",
      Destination: { ToAddresses: [adminEmail] },
      Message: {
        Subject: { Data: `Email delivery failures: ${failures.length} not delivered` },
        Body: { Html: { Data: html } },
      },
    }),
  );

  await EmailMessage.updateMany(
    { _id: { $in: failures.map((f) => f._id) } },
    { $set: { failureNotifiedAt: new Date() } },
  );
  return { reported: failures.length, events: groups.size };
};
