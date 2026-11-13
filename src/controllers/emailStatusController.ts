import { Request, Response } from "express";
import { Types } from "mongoose";
import { EmailMessage } from "../models/emailMessage";
import { Guest } from "../models/guestmodel";
import { RSVP } from "../models/rsvpmodel";

// Delivery state shown to admins. "bounced"/"rejected"/"complained" come from
// SES feedback that can arrive minutes or hours after the send.
const viewStatus = (m: any): string => {
  const d = String(m.deliveryStatus || "");
  if (["bounced", "rejected", "complained", "delivered"].includes(d)) return d;
  if (m.status === "failed" || d === "failed") return "failed";
  if (m.status === "sent" || d === "accepted") return "sent";
  return "pending";
};

/** GET /guest/email-status/:eventId — email delivery status for an event. */
export const getEmailStatus = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (!eventId || !Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ message: "Valid event ID is required" });
    }

    const messages = (await EmailMessage.find({ eventId })
      .sort({ createdAt: -1 })
      .limit(5000)
      .select({
        guestEmail: 1, subject: 1, messageType: 1, status: 1, deliveryStatus: 1,
        failureReason: 1, sentAt: 1, deliveredAt: 1, bouncedAt: 1, lastEventAt: 1,
        createdAt: 1, rsvpId: 1, openCount: 1,
      })
      .lean()) as any[];

    const emails = [...new Set(messages.map((m) => String(m.guestEmail || "").toLowerCase()).filter(Boolean))];
    const rsvpIds = [...new Set(messages.map((m) => String(m.rsvpId || "")).filter(Boolean))];
    const [guests, rsvps] = await Promise.all([
      emails.length
        ? Guest.find({ eventId, email: { $in: emails } }).select("fullname email").collation({ locale: "en", strength: 2 }).lean()
        : Promise.resolve([] as any[]),
      rsvpIds.length ? RSVP.find({ _id: { $in: rsvpIds } }).select("guestName").lean() : Promise.resolve([] as any[]),
    ]);
    const nameByEmail = new Map((guests as any[]).map((g) => [String(g.email || "").toLowerCase(), g.fullname]));
    const nameByRsvp = new Map((rsvps as any[]).map((r) => [String(r._id), r.guestName]));

    const stats: Record<string, number> = {
      total: messages.length, sent: 0, delivered: 0, bounced: 0, rejected: 0, complained: 0, failed: 0, pending: 0,
    };
    const rows = messages.map((m) => {
      const status = viewStatus(m);
      stats[status] = (stats[status] || 0) + 1;
      return {
        id: m._id,
        guestName:
          nameByRsvp.get(String(m.rsvpId || "")) ||
          nameByEmail.get(String(m.guestEmail || "").toLowerCase()) ||
          "",
        email: m.guestEmail,
        subject: m.subject || "",
        messageType: m.messageType || "",
        status,
        failureReason: m.failureReason || "",
        sentAt: m.sentAt || m.createdAt,
        deliveredAt: m.deliveredAt || null,
        failedAt: m.bouncedAt || (status === "failed" || status === "rejected" ? m.lastEventAt : null),
        opened: (m.openCount || 0) > 0,
      };
    });

    return res.json({ stats, messages: rows });
  } catch (error: any) {
    console.error("Email status error:", error);
    return res.status(500).json({ message: "Failed to get email status", error: error.message });
  }
};
