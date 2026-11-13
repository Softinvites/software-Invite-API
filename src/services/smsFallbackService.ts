import { WhatsAppMessage } from "../models/WhatsAppMessage";
import { Event } from "../models/eventmodel";
import { RSVP } from "../models/rsvpmodel";
import { Guest } from "../models/guestmodel";
import smsService from "../utils/smsService";

const API_BASE = "https://292x833w13.execute-api.us-east-2.amazonaws.com";
const SITE_BASE = (process.env.FRONTEND_URL || "https://www.softinvite.com").replace(/\/$/, "");

const firstName = (name?: string) => String(name || "").trim().split(/\s+/)[0] || "";
const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v);

/**
 * When Twilio reports a WhatsApp message as undelivered/failed, send the guest
 * one SMS instead — only for events with "SMS backup" switched on. The atomic
 * claim on smsFallbackAt makes this run at most once per WhatsApp message even
 * though Twilio may report the failure more than once.
 */
export const sendSmsFallbackForWhatsApp = async (
  providerMessageId: string,
  errorCode?: string,
): Promise<void> => {
  const original: any = await WhatsAppMessage.findOne({ providerMessageId })
    .select({ eventId: 1, rsvpId: 1, guestId: 1, phoneNumber: 1, smsFallbackAt: 1 })
    .lean();
  if (!original || original.smsFallbackAt || !original.phoneNumber) return;

  const event: any = await Event.findById(original.eventId)
    .select({ name: 1, smsFallbackEnabled: 1 })
    .lean();
  if (!event?.smsFallbackEnabled) return;

  // Claim it first so a second callback can never send a second SMS.
  const claimed = await WhatsAppMessage.findOneAndUpdate(
    { _id: original._id, smsFallbackAt: null },
    { $set: { smsFallbackAt: new Date(), smsFallbackStatus: "sending" } },
  );
  if (!claimed) return;

  try {
    let guestName = "";
    let link = "";
    let rsvpId: string | undefined;
    if (original.rsvpId) {
      const rsvp: any = await RSVP.findById(original.rsvpId).select({ guestName: 1 }).lean();
      if (rsvp) {
        guestName = rsvp.guestName;
        rsvpId = String(rsvp._id);
        link = `${SITE_BASE}/rsvp/respond/${rsvp._id}`;
      }
    }
    if (!link && original.guestId) {
      const guest: any = await Guest.findById(original.guestId).select({ fullname: 1 }).lean();
      if (guest) {
        guestName = guest.fullname;
        link = `${API_BASE}/guest/download-emailcode/${guest._id}`;
      }
    }
    if (!link) {
      await WhatsAppMessage.updateOne(
        { _id: original._id },
        { $set: { smsFallbackStatus: "skipped", smsFallbackError: "Guest record not found" } },
      );
      return;
    }

    const action = rsvpId ? "Kindly RSVP here" : "Your access code";
    const hi = firstName(guestName) ? `Dear ${firstName(guestName)}, ` : "";
    const message = `${hi}you are invited to ${clip(String(event.name || "our event"), 60)}. ${action}: ${link}`;

    const result: any = await smsService.sendSms({
      to: original.phoneNumber,
      message,
      eventId: String(original.eventId),
      rsvpId,
    });
    await WhatsAppMessage.updateOne(
      { _id: original._id },
      {
        $set: {
          smsFallbackStatus: result?.success ? "sent" : "failed",
          smsFallbackError: result?.success ? null : String(result?.error || "SMS failed"),
          fallbackChannel: "sms",
        },
      },
    );
    console.log("[SmsFallback] WhatsApp failed - SMS backup", {
      whatsappSid: providerMessageId,
      errorCode: errorCode || null,
      success: !!result?.success,
      provider: result?.provider || null,
      error: result?.success ? null : result?.error,
    });
  } catch (error: any) {
    console.error("[SmsFallback] error", error);
    await WhatsAppMessage.updateOne(
      { _id: original._id },
      { $set: { smsFallbackStatus: "failed", smsFallbackError: error?.message || "SMS failed" } },
    );
  }
};
