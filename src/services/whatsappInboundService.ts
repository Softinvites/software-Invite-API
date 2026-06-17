import { Guest } from "../models/guestmodel.js";
import { RSVP } from "../models/rsvpmodel.js";
import { WhatsAppInboundMessage } from "../models/WhatsAppInboundMessage.js";
import mongoose from "mongoose";

type PersistInboundArgs = {
  provider: "twilio" | "meta";
  from: string;
  to?: string | null;
  body?: string | null;
  profileName?: string | null;
  waId?: string | null;
  providerMessageId?: string | null;
  payload?: any;
  receivedAt?: Date;
};

const normalizePhoneValue = (value: string) =>
  String(value || "")
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d+]/g, "")
    .trim();

const buildCandidatePhones = (value: string) => {
  const normalized = normalizePhoneValue(value);
  if (!normalized) return [];

  const set = new Set<string>();
  set.add(normalized);
  if (!normalized.startsWith("+")) set.add(`+${normalized}`);

  const digits = normalized.replace(/[^\d]/g, "");
  if (digits) {
    set.add(digits);
    set.add(`+${digits}`);
  }

  if (digits.startsWith("234") && digits.length >= 13) {
    set.add(`0${digits.slice(3)}`);
  } else if (digits.startsWith("0") && digits.length >= 10) {
    set.add(`+234${digits.slice(1)}`);
    set.add(`234${digits.slice(1)}`);
  }

  return Array.from(set).filter(Boolean);
};

const findRelatedEntities = async (from: string, waId?: string | null) => {
  // Build candidates from both `from` and `waId` (Twilio sends clean number in WaId)
  const fromCandidates = buildCandidatePhones(from);
  const waIdCandidates = waId ? buildCandidatePhones(waId) : [];
  const candidates = Array.from(new Set([...fromCandidates, ...waIdCandidates])).filter(Boolean);

  if (!candidates.length) {
    return { guest: null, rsvp: null };
  }

  const guest = await Guest.findOne({ phone: { $in: candidates } })
    .select({ _id: 1, eventId: 1 })
    .lean();

  if (guest) {
    return { guest, rsvp: null };
  }

  const rsvp = await RSVP.findOne({ phone: { $in: candidates } })
    .select({ _id: 1, eventId: 1 })
    .lean();

  return { guest: null, rsvp };
};

export const persistInboundWhatsAppMessage = async ({
  provider,
  from,
  to = null,
  body = "",
  profileName = null,
  waId = null,
  providerMessageId = null,
  payload = null,
  receivedAt = new Date(),
}: PersistInboundArgs) => {
  const { guest, rsvp } = await findRelatedEntities(from, waId);
  const eventId = guest?.eventId || rsvp?.eventId || null;

  const updatePayload = {
    provider,
    from,
    to,
    body: body || "",
    profileName,
    waId,
    providerMessageId,
    receivedAt,
    payload,
    eventId,
    guestId: guest?._id || null,
    rsvpId: rsvp?._id || null,
    followUpRequired: true,
    status: "received",
  };

  if (providerMessageId) {
    return WhatsAppInboundMessage.findOneAndUpdate(
      { provider, providerMessageId },
      updatePayload,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  return WhatsAppInboundMessage.create(updatePayload);
};

/**
 * Back-fill eventId on existing inbound messages that were saved with eventId=null
 * because the phone lookup failed at receive time. Called by getWhatsAppReplies.
 */
export const backfillInboundEventIds = async (eventId: string) => {
  const unmatched = await WhatsAppInboundMessage.find({ eventId: null })
    .select({ _id: 1, from: 1, waId: 1 })
    .lean();

  if (!unmatched.length) return;

  const oid = new mongoose.Types.ObjectId(eventId);

  for (const msg of unmatched) {
    const { guest, rsvp } = await findRelatedEntities(
      String(msg.from || ""),
      msg.waId ? String(msg.waId) : null,
    );
    const resolvedEventId = guest?.eventId || rsvp?.eventId || null;
    if (!resolvedEventId) continue;

    // Only update if it belongs to the requested event
    if (String(resolvedEventId) !== String(oid)) continue;

    await WhatsAppInboundMessage.updateOne(
      { _id: msg._id },
      {
        $set: {
          eventId: resolvedEventId,
          ...(guest ? { guestId: guest._id } : {}),
          ...(rsvp ? { rsvpId: rsvp._id } : {}),
        },
      },
    );
  }
};
