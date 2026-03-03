import { Request, Response } from "express";
import { parse as parseCsv } from "fast-csv";
import xlsx from "xlsx";
import { Readable } from "stream";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { RSVPFormLink } from "../models/rsvpFormLinkModel";
import { InvitationRecord } from "../models/invitationRecord";
import { MessageSchedule } from "../models/messageSchedule";
import { generateRsvpToken } from "../utils/rsvpToken";
import { sendEmail } from "../library/helpers/emailService";
import { invokeLambda } from "../utils/lambdaUtils";
import fs from "fs";
import path from "path";

type AttendanceStatus = "pending" | "yes" | "no";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "softinvites@gmail.com";

const resolveServicePackage = (event: any) =>
  (event?.servicePackage as string) || "standard-rsvp";

let invitationTemplateCache: string | null = null;
const renderInvitationOnlyEmail = (event: any, guestName: string) => {
  if (!invitationTemplateCache) {
    const candidatePaths = [
      path.join(process.cwd(), "src", "templates", "invitation-only-email-template.hbs"),
      path.join(process.cwd(), "dist", "templates", "invitation-only-email-template.hbs"),
      path.join(__dirname, "..", "templates", "invitation-only-email-template.hbs"),
    ];
    const templatePath = candidatePaths.find((p) => fs.existsSync(p));
    if (templatePath) {
      invitationTemplateCache = fs.readFileSync(templatePath, "utf8");
    } else {
      invitationTemplateCache =
        "<div><h1>{{eventName}}</h1><p>{{eventDate}}</p><p>{{message}}</p></div>";
    }
  }
  const headerBg = (event as any).rsvpBgColor
    ? `rgb(${(event as any).rsvpBgColor})`
    : (event as any).qrCodeBgColor
      ? `rgb(${(event as any).qrCodeBgColor})`
      : "#111827";
  const message =
    (event as any).rsvpMessage ||
    event.description ||
    "You're invited! Please check the details below.";

  return (invitationTemplateCache || "")
    .replace(/{{eventName}}/g, event.name || "")
    .replace(/{{eventDate}}/g, event.date || "")
    .replace(/{{guestName}}/g, guestName || "Guest")
    .replace(/{{headerBg}}/g, headerBg)
    .replace(/{{message}}/g, message);
};

const scheduleStandardMessages = async (event: any) => {
  const eventId = event._id;
  const now = new Date();
  const reminderDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const eventEnd =
    (event as any).eventEndDate ||
    (event as any).date ||
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const eventEndDate = new Date(eventEnd);
  const thankYouDate = new Date(eventEndDate.getTime() + 24 * 60 * 60 * 1000);

  const existing = await MessageSchedule.find({
    eventId,
    messageType: { $in: ["reminder", "thankyou"] },
    status: "pending",
  });
  const hasReminder = existing.some((s) => s.messageType === "reminder");
  const hasThankYou = existing.some((s) => s.messageType === "thankyou");

  const schedules: any[] = [];
  if (!hasReminder) {
    schedules.push({
      eventId,
      messageType: "reminder",
      messageName: "Reminder",
      scheduledDate: reminderDate,
      status: "pending",
      targetAudience: "non-responders",
      channel: "email",
      servicePackage: "standard-rsvp",
    });
  }
  if (!hasThankYou) {
    schedules.push({
      eventId,
      messageType: "thankyou",
      messageName: "Thank You",
      scheduledDate: thankYouDate,
      status: "pending",
      targetAudience: "responders",
      channel: "email",
      servicePackage: "standard-rsvp",
    });
  }

  if (schedules.length) {
    await MessageSchedule.insertMany(schedules);
  }
};

const defaultFullSequence = [
  { dayOffset: 1, messageName: "Initial Invitation", channels: { email: { enabled: true } } },
  { dayOffset: 4, messageName: "Event Details", channels: { email: { enabled: true } } },
  { dayOffset: 7, messageName: "Reminder", channels: { email: { enabled: true } } },
  { dayOffset: 14, messageName: "Follow Up", channels: { email: { enabled: true } } },
  { dayOffset: 21, messageName: "Last Call", channels: { email: { enabled: true } } },
  { dayOffset: 28, messageName: "Final Logistics", channels: { email: { enabled: true } } },
  { dayOffset: 31, messageName: "Post Event Thanks", channels: { email: { enabled: true } } },
];

const scheduleFullMessages = async (event: any) => {
  const existing = await MessageSchedule.find({
    eventId: event._id,
    status: "pending",
    servicePackage: "full-rsvp",
  });
  if (existing.length) {
    return;
  }
  const sequence =
    Array.isArray(event.customMessageSequence) && event.customMessageSequence.length
      ? event.customMessageSequence
      : defaultFullSequence;
  const now = new Date();
  const schedules: any[] = [];

  for (const item of sequence) {
    const dayOffset = Number(item.dayOffset || 0);
    const scheduledDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const channels = item.channels || { email: { enabled: true } };
    const eventChannelConfig = (event as any)?.channelConfig || {};
    const channelEntries: Array<{ channel: "email" | "whatsapp" | "bulkSms"; enabled?: boolean }> = [
      { channel: "email", enabled: channels?.email?.enabled !== false },
      {
        channel: "whatsapp",
        enabled:
          !!channels?.whatsapp?.enabled && eventChannelConfig?.whatsapp?.enabled !== false,
      },
      {
        channel: "bulkSms",
        enabled:
          !!channels?.bulkSms?.enabled && eventChannelConfig?.bulkSms?.enabled !== false,
      },
    ];

    for (const ch of channelEntries) {
      if (!ch.enabled) continue;
      schedules.push({
        eventId: event._id,
        messageType: "custom",
        messageName: item.messageName || "Custom Message",
        scheduledDate,
        status: "pending",
        targetAudience: item?.conditions?.audienceType || "all",
        channel: ch.channel,
        templateId:
          ch.channel === "email"
            ? item?.channels?.email?.templateId || null
            : ch.channel === "whatsapp"
              ? item?.channels?.whatsapp?.templateId || null
              : item?.channels?.bulkSms?.templateId || null,
        servicePackage: "full-rsvp",
      });
    }
  }

  if (schedules.length) {
    await MessageSchedule.insertMany(schedules);
  }
};

function normalizeRow(obj: any) {
  const clean = (val: any) => {
    if (val === null || val === undefined) return "";
    return String(val).trim();
  };
  return {
    guestName: clean(
      obj["guest_name"] ||
        obj["guestName"] ||
        obj["fullname"] ||
        obj["Full Name"] ||
        obj["name"] ||
        obj["Name"] ||
        "",
    ),
    email: clean(obj["email"] || obj["Email"] || ""),
    phone: clean(obj["phone"] || obj["Phone"] || ""),
    qrCodeCenterColor: clean(
      obj["qrCodeCenterColor"] || obj["qr_code_center_color"] || "",
    ),
    qrCodeEdgeColor: clean(
      obj["qrCodeEdgeColor"] || obj["qr_code_edge_color"] || "",
    ),
    qrCodeBgColor: clean(
      obj["qrCodeBgColor"] || obj["qr_code_bg_color"] || "",
    ),
  };
}

async function parseCsvExcelBuffer(
  buffer: Buffer,
  filename: string,
): Promise<any[]> {
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  if (extension === "csv") {
    return await new Promise((resolve, reject) => {
      const rows: any[] = [];
      const stream = Readable.from(buffer.toString());
      stream
        .pipe(parseCsv({ headers: true }))
        .on("data", (row) => rows.push(normalizeRow(row)))
        .on("end", () => resolve(rows))
        .on("error", reject);
    });
  }

  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName] || {});
  if (!Array.isArray(data)) return [];
  return data.map((row) => normalizeRow(row));
}

function buildRsvpEmailHtml(
  event: any,
  guestName: string,
  rsvpId?: string,
  baseUrl?: string,
  options?: { showButtons?: boolean },
) {
  const headerBg = (event as any).rsvpBgColor
    ? `rgb(${(event as any).rsvpBgColor})`
    : (event as any).qrCodeBgColor
      ? `rgb(${(event as any).qrCodeBgColor})`
      : "#111827";
  const accent = (event as any).rsvpAccentColor
    ? `rgb(${(event as any).rsvpAccentColor})`
    : (event as any).qrCodeCenterColor
      ? `rgb(${(event as any).qrCodeCenterColor})`
      : "#111827";
  const showButtons = options?.showButtons !== false;
  const safeBase = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  const yesUrl =
    showButtons && safeBase && rsvpId
      ? `${safeBase}/rsvp/respond/${rsvpId}?status=yes`
      : "";
  const noUrl =
    showButtons && safeBase && rsvpId
      ? `${safeBase}/rsvp/respond/${rsvpId}?status=no`
      : "";

  return `
    <div style="font-family:'Segoe UI','Arial',sans-serif;background:#f7f8fc;padding:24px 10px;line-height:1.6;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.08);">
        <div style="background:${headerBg};padding:24px 20px;text-align:center;color:#fff;">
          <h1 style="margin:0 0 6px 0;font-size:22px;">${event.name}</h1>
          <p style="margin:0;font-size:14px;">${event.date}</p>
        </div>
        <div style="padding:24px 20px;">
          <p style="font-size:15px;margin:0 0 16px 0;">Dear ${guestName},</p>
          <div style="font-size:14px;color:#4a5568;line-height:1.7;margin:0 0 20px 0;">
            ${event.rsvpMessage || event.description || "You're invited! Please let us know if you will attend."}
          </div>
          ${
            showButtons && yesUrl && noUrl
              ? `
          <p style="font-size:14px;margin:0 0 12px 0;">Will you attend?</p>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <a href="${yesUrl}" style="display:inline-block;background:${headerBg};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Yes</a>
            <a href="${noUrl}" style="display:inline-block;background:${accent};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">No</a>
          </div>
          <p style="font-size:12px;color:#94a3b8;margin-top:16px;">
            If the buttons do not work, you can copy these links into your browser:
          </p>
          <p style="font-size:12px;color:#94a3b8;margin:0;">Yes: ${yesUrl}</p>
          <p style="font-size:12px;color:#94a3b8;margin:0;">No: ${noUrl}</p>
          `
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

async function sendRsvpEmailsBatch(
  event: any,
  rsvps: Array<{
    _id: any;
    guestName: string;
    email?: string;
  }>,
  baseUrl: string,
) {
  const emails = rsvps.filter((r) => r.email);
  if (!emails.length) return { sent: 0, skipped: rsvps.length };
  const trackingEnabled =
    (event as any)?.channelConfig?.email?.trackingEnabled !== false;
  const replyTo = (event as any)?.channelConfig?.email?.replyTo;

  if (emails.length > 1000 && process.env.RSVP_BULK_EMAIL_LAMBDA_NAME) {
    await invokeLambda(
      process.env.RSVP_BULK_EMAIL_LAMBDA_NAME,
      {
        type: "rsvp",
        event: {
          id: event._id,
          name: event.name,
          date: event.date,
          description: event.description,
          rsvpMessage: (event as any).rsvpMessage,
          rsvpBgColor: (event as any).rsvpBgColor,
          rsvpAccentColor: (event as any).rsvpAccentColor,
          qrCodeBgColor: (event as any).qrCodeBgColor,
          qrCodeCenterColor: (event as any).qrCodeCenterColor,
        },
        baseUrl,
        recipients: emails,
      },
      true,
    );
    return { sent: emails.length, skipped: rsvps.length - emails.length };
  }

  let sent = 0;
  let skipped = 0;
  for (const rsvp of rsvps) {
    if (!rsvp.email) {
      skipped += 1;
      continue;
    }
    const html = buildRsvpEmailHtml(
      event,
      rsvp.guestName,
      String(rsvp._id),
      baseUrl,
    );
    await sendEmail(
      rsvp.email,
      `RSVP for ${event.name}`,
      html,
      `SoftInvites <info@softinvite.com>`,
      undefined,
      {
        eventId: String(event._id),
        rsvpId: String(rsvp._id),
        messageType: "rsvp-initial",
        trackingEnabled,
        replyTo,
      },
    );
    sent += 1;
  }
  return { sent, skipped };
}

async function sendInvitationEmailsBatch(
  event: any,
  invitations: Array<{
    _id: any;
    guestName: string;
    email?: string;
  }>,
) {
  let sent = 0;
  let skipped = 0;
  const trackingEnabled =
    (event as any)?.channelConfig?.email?.trackingEnabled !== false;
  const replyTo = (event as any)?.channelConfig?.email?.replyTo;

  for (const invite of invitations) {
    if (!invite.email) {
      skipped += 1;
      continue;
    }
    const html = buildRsvpEmailHtml(event, invite.guestName, undefined, undefined, {
      showButtons: false,
    });
    try {
      await sendEmail(
        invite.email,
        `Invitation to ${event.name}`,
        html,
        `SoftInvites <info@softinvite.com>`,
        undefined,
        {
          eventId: String(event._id),
          messageType: "invitation-only",
          trackingEnabled,
          replyTo,
        },
      );
      await InvitationRecord.findByIdAndUpdate(invite._id, {
        invitationSent: true,
        deliveryStatus: "sent",
        $inc: { sentCount: 1 },
        lastSentAt: new Date(),
        lastError: null,
      });
      sent += 1;
    } catch (error: any) {
      await InvitationRecord.findByIdAndUpdate(invite._id, {
        invitationSent: false,
        deliveryStatus: "failed",
        lastError: error?.message || "Failed to send email",
      });
      skipped += 1;
    }
  }

  return { sent, skipped };
}

export const getRsvpGuests = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const servicePackage = resolveServicePackage(event);
    if (servicePackage === "invitation-only") {
      const invitations = await InvitationRecord.find({ eventId }).sort({
        createdAt: -1,
      });
      const summary = invitations.reduce(
        (acc, r) => {
          acc.sent += r.invitationSent ? 1 : 0;
          acc.pending += r.invitationSent ? 0 : 1;
          acc.total += 1;
          return acc;
        },
        { sent: 0, pending: 0, total: 0 } as Record<string, number>,
      );
      return res.json({
        mode: "invitation-only",
        invitations,
        summary,
      });
    }

    const rsvps = await RSVP.find({ eventId }).sort({ createdAt: -1 });
    const summary = rsvps.reduce(
      (acc, r) => {
        const key = r.attendanceStatus || "pending";
        acc[key] = (acc[key] || 0) + 1;
        acc.total += 1;
        return acc;
      },
      { yes: 0, no: 0, pending: 0, total: 0 } as Record<string, number>,
    );
    res.json({ rsvps, summary, mode: "rsvp" });
  } catch (error: any) {
    console.error("getRsvpGuests error", error);
    res.status(500).json({ message: "Failed to load RSVP guests" });
  }
};

export const addRsvpGuest = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { guestName, email, phone } = req.body;

    if (!guestName) {
      return res.status(400).json({ message: "Guest name is required" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const servicePackage = resolveServicePackage(event);

    if (servicePackage === "invitation-only") {
      const invitation = await InvitationRecord.create({
        eventId,
        guestName: String(guestName).trim(),
        email: email || null,
        phone: phone || null,
        source: "manual",
      });

      if (invitation.email) {
        await sendInvitationEmailsBatch(event, [invitation]);
      }

      return res
        .status(201)
        .json({ message: "Invitation guest created", invitation });
    }

    const rsvp = await RSVP.create({
      eventId,
      token: generateRsvpToken(),
      guestName: String(guestName).trim(),
      email: email || null,
      phone: phone || null,
      attendanceStatus: "pending",
      source: "imported",
      isEditable: true,
      qrCodeBgColor: (event as any).qrCodeBgColor,
      qrCodeCenterColor: (event as any).qrCodeCenterColor,
      qrCodeEdgeColor: (event as any).qrCodeEdgeColor,
    });

    const baseUrl =
      req.body?.publicBaseUrl ||
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "";
    if (baseUrl && rsvp.email) {
      await sendRsvpEmailsBatch(event, [rsvp], baseUrl);
    }

    return res.status(201).json({ message: "RSVP guest created", rsvp });
  } catch (error: any) {
    console.error("addRsvpGuest error", error);
    res
      .status(500)
      .json({ message: "Failed to create RSVP guest", error: error.message });
  }
};

export const importRsvpGuests = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const rows = await parseCsvExcelBuffer(
      req.file.buffer,
      req.file.originalname,
    );
    if (!rows.length) {
      return res
        .status(400)
        .json({ message: "No valid rows found in the file" });
    }

    const servicePackage = resolveServicePackage(event);
    const created: any[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (!row.guestName) {
        skipped += 1;
        continue;
      }
      if (servicePackage === "invitation-only") {
        const invitation = await InvitationRecord.create({
          eventId,
          guestName: row.guestName,
          email: row.email || null,
          phone: row.phone || null,
          source: "imported",
        });
        created.push(invitation);
      } else {
        const rsvp = await RSVP.create({
          eventId,
          token: generateRsvpToken(),
          guestName: row.guestName,
          email: row.email || null,
          phone: row.phone || null,
          attendanceStatus: "pending",
          source: "imported",
          isEditable: true,
          qrCodeBgColor: row.qrCodeBgColor || (event as any).qrCodeBgColor,
          qrCodeCenterColor:
            row.qrCodeCenterColor || (event as any).qrCodeCenterColor,
          qrCodeEdgeColor: row.qrCodeEdgeColor || (event as any).qrCodeEdgeColor,
        });
        created.push(rsvp);
      }
    }

    const baseUrl =
      req.body?.publicBaseUrl ||
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "";
    if (servicePackage === "invitation-only") {
      if (created.length) {
        await sendInvitationEmailsBatch(event, created as any);
      }
    } else if (baseUrl) {
      await sendRsvpEmailsBatch(event, created as any, baseUrl);
    }

    if (ADMIN_EMAIL) {
      await sendEmail(
        ADMIN_EMAIL,
        `${servicePackage === "invitation-only" ? "Invitation" : "RSVP"} import summary for ${event.name}`,
        `<p>Imported ${created.length} ${
          servicePackage === "invitation-only" ? "invitation" : "RSVP"
        } guests (skipped ${skipped}).</p>`,
      );
    }

    return res.json({
      message:
        servicePackage === "invitation-only"
          ? "Invitation guest import completed"
          : "RSVP guest import completed",
      created: created.length,
      skipped,
      total: rows.length,
    });
  } catch (error: any) {
    console.error("importRsvpGuests error", error);
    res
      .status(500)
      .json({ message: "Failed to import RSVP guests", error: error.message });
  }
};

export const sendRsvpInvites = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { publicBaseUrl, rsvpIds } = req.body || {};

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const servicePackage = resolveServicePackage(event);

    if (servicePackage === "invitation-only") {
      const filter: any = { eventId };
      if (Array.isArray(rsvpIds) && rsvpIds.length > 0) {
        filter._id = { $in: rsvpIds };
      }
      const invitations = await InvitationRecord.find(filter);
      const result = await sendInvitationEmailsBatch(event, invitations as any);
      return res.json({
        message: "Invitations sent",
        sent: result.sent,
        skipped: result.skipped,
        total: invitations.length,
      });
    }

    const baseUrl =
      publicBaseUrl ||
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "";
    if (!baseUrl) {
      return res.status(400).json({ message: "Missing public RSVP base URL" });
    }

    const filter: any = { eventId, attendanceStatus: "pending" };
    if (Array.isArray(rsvpIds) && rsvpIds.length > 0) {
      filter._id = { $in: rsvpIds };
    }

    const rsvps = await RSVP.find(filter);
    const result = await sendRsvpEmailsBatch(event, rsvps as any, baseUrl);

    if (servicePackage === "standard-rsvp") {
      await scheduleStandardMessages(event);
    }
    if (servicePackage === "full-rsvp") {
      await scheduleFullMessages(event);
    }

    return res.json({
      message: "RSVP invites sent",
      sent: result.sent,
      skipped: result.skipped,
      total: rsvps.length,
    });
  } catch (error: any) {
    console.error("sendRsvpInvites error", error);
    res
      .status(500)
      .json({ message: "Failed to send RSVP invites", error: error.message });
  }
};

export const updateRsvpStatus = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const { status } = req.body as { status: AttendanceStatus };
    if (!status || !["yes", "no", "pending"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const rsvp = await RSVP.findByIdAndUpdate(
      rsvpId,
      {
        attendanceStatus: status,
        submissionDate: new Date(),
      },
      { new: true },
    );
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }
    return res.json({ message: "RSVP status updated", rsvp });
  } catch (error: any) {
    console.error("updateRsvpStatus error", error);
    res.status(500).json({ message: "Failed to update RSVP status" });
  }
};

export const deleteRsvpGuest = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const deleted = await RSVP.findByIdAndDelete(rsvpId);
    if (deleted) {
      return res.json({ message: "RSVP guest deleted" });
    }
    const inviteDeleted = await InvitationRecord.findByIdAndDelete(rsvpId);
    if (inviteDeleted) {
      return res.json({ message: "Invitation guest deleted" });
    }
    return res.status(404).json({ message: "RSVP guest not found" });
  } catch (error: any) {
    console.error("deleteRsvpGuest error", error);
    res.status(500).json({ message: "Failed to delete RSVP guest" });
  }
};

export const exportRsvpCsv = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    const servicePackage = resolveServicePackage(event);

    if (servicePackage === "invitation-only") {
      const invitations = await InvitationRecord.find({ eventId });

      const escapeCsv = (value: any) => {
        const str = value === null || value === undefined ? "" : String(value);
        return `"${str.replace(/"/g, '""')}"`;
      };

      const header = [
        "invitationId",
        "guestName",
        "email",
        "phone",
        "invitationSent",
        "sentCount",
        "lastSentAt",
      ];

      const lines = invitations.map((r) => {
        const cols = [
          r._id.toString(),
          r.guestName || "",
          r.email || "",
          r.phone || "",
          r.invitationSent ? "sent" : "pending",
          r.sentCount || 0,
          r.lastSentAt ? new Date(r.lastSentAt).toISOString() : "",
        ];
        return cols.map(escapeCsv).join(",");
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=event-${eventId}-invitation.csv`,
      );
      res.send([header.join(","), ...lines].join("\n"));
      return;
    }

    const rsvps = await RSVP.find({ eventId });

    const escapeCsv = (value: any) => {
      const str = value === null || value === undefined ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const header = [
      "rsvpId",
      "guestName",
      "email",
      "phone",
      "attendanceStatus",
      "comments",
      "source",
      "submissionDate",
    ];

    const lines = rsvps.map((r) => {
      const cols = [
        r._id.toString(),
        r.guestName || "",
        r.email || "",
        r.phone || "",
        r.attendanceStatus || "pending",
        r.comments || "",
        r.source || "",
        r.submissionDate ? new Date(r.submissionDate).toISOString() : "",
      ];
      return cols.map(escapeCsv).join(",");
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=event-${eventId}-rsvp.csv`,
    );
    res.send([header.join(","), ...lines].join("\n"));
  } catch (error: any) {
    console.error("exportRsvpCsv error", error);
    res.status(500).json({ message: "Failed to export RSVP CSV" });
  }
};

export const generateRsvpFormLink = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    if (resolveServicePackage(event) === "invitation-only") {
      return res
        .status(400)
        .json({ message: "RSVP form is disabled for invitation-only events" });
    }

    const token = generateRsvpToken();
    const link = await RSVPFormLink.create({ eventId, token });
    const baseUrl =
      req.body?.publicBaseUrl ||
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "";

    return res.json({
      token: link.token,
      url: baseUrl
        ? `${baseUrl.replace(/\/$/, "")}/rsvp/form/${link.token}`
        : link.token,
    });
  } catch (error: any) {
    console.error("generateRsvpFormLink error", error);
    res.status(500).json({ message: "Failed to generate RSVP form link" });
  }
};
