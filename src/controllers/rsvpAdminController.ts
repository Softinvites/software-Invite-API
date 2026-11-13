import { Request, Response } from "express";
import { parse as parseCsv } from "fast-csv";
import xlsx from "xlsx";
import { Readable } from "stream";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { buildEventEmailFrom } from "../utils/emailSender";
import { RSVPFormLink } from "../models/rsvpFormLinkModel";
import { InvitationRecord } from "../models/invitationRecord";
import { generateRsvpToken } from "../utils/rsvpToken";
import { sendEmail } from "../library/helpers/emailService";
import { invokeLambda } from "../utils/lambdaUtils";
import { syncFullRsvpPendingSchedules } from "../services/fullRsvpScheduleService";
import fs from "fs";
import path from "path";

type AttendanceStatus = "pending" | "yes" | "no";

const resolveServicePackage = (event: any) =>
  (event?.servicePackage as string) || "standard-rsvp";

const DEFAULT_ATTENDANCE_LABEL = "Will you attend?";
const DEFAULT_ATTENDANCE_YES_LABEL = "YES, I WILL ATTEND";
const DEFAULT_ATTENDANCE_NO_LABEL = "UNABLE TO ATTEND";
const RSVP_FORM_TOKEN_BYTES = 12;

const normalizeGuestCount = (value: any, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
};

const normalizeTag = (value: any) => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
};

const slugifyLinkTitle = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const getRsvpGuestWeight = (rsvp: any) => normalizeGuestCount(rsvp?.guestCount, 1);

const buildRsvpSummary = (rsvps: any[]) =>
  rsvps.reduce(
    (acc, r) => {
      const key = r.attendanceStatus || "pending";
      const weight = getRsvpGuestWeight(r);
      acc[key] = (acc[key] || 0) + weight;
      acc.total += weight;
      return acc;
    },
    { yes: 0, no: 0, pending: 0, total: 0 } as Record<string, number>,
  );

const shouldIncludeInitialResponseButtons = (event: any) => {
  const sequence = Array.isArray((event as any)?.customMessageSequence)
    ? (event as any).customMessageSequence
    : [];
  for (const item of sequence) {
    if (item?.channels?.email?.enabled === false) {
      continue;
    }
    return item?.includeResponseButtons !== false;
  }
  return true;
};

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

const resolveInitialRsvpSubject = (event: any) => {
  const fallback = `RSVP for ${event.name}`;
  const sequence = Array.isArray((event as any)?.customMessageSequence)
    ? (event as any).customMessageSequence
    : [];
  for (const item of sequence) {
    if (item?.channels?.email?.enabled === false) {
      continue;
    }
    const title =
      typeof item?.messageTitle === "string" && item.messageTitle.trim()
        ? item.messageTitle.trim()
        : typeof item?.messageName === "string" && item.messageName.trim()
          ? item.messageName.trim()
          : "";
    if (title) {
      return title;
    }
  }
  return fallback;
};

const scheduleFullMessages = async (event: any) => {
  await syncFullRsvpPendingSchedules(event, { replacePending: false });
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
    guestCount: normalizeGuestCount(
      obj["guestCount"] ||
        obj["guest_count"] ||
        obj["Guest Count"] ||
        obj["guest count"] ||
        1,
    ),
    tag: normalizeTag(obj["tag"] || obj["Tag"] || ""),
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

// Branded SoftInvites copyright footer.
const softInvitesFooterHtml = () => `
        <div style="background:#f7f8fc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="font-size:12px;color:#718096;margin:0;">Copyright &copy; ${new Date().getFullYear()} <strong style="color:#4a5568;">SoftInvites</strong>. All rights reserved.</p>
        </div>`;

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
  const showButtons =
    options?.showButtons !== false && shouldIncludeInitialResponseButtons(event);
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
          <p style="font-size:14px;margin:0 0 12px 0;">${DEFAULT_ATTENDANCE_LABEL}</p>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <a href="${yesUrl}" style="display:inline-block;background:${headerBg};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${DEFAULT_ATTENDANCE_YES_LABEL}</a>
            <a href="${noUrl}" style="display:inline-block;background:${accent};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${DEFAULT_ATTENDANCE_NO_LABEL}</a>
          </div>
          <p style="font-size:12px;color:#94a3b8;margin-top:16px;">
            If the buttons do not work, you can copy these links into your browser:
          </p>
          <p style="font-size:12px;color:#94a3b8;margin:0;">${DEFAULT_ATTENDANCE_YES_LABEL}: ${yesUrl}</p>
          <p style="font-size:12px;color:#94a3b8;margin:0;">${DEFAULT_ATTENDANCE_NO_LABEL}: ${noUrl}</p>
          `
              : ""
          }
        </div>
        ${softInvitesFooterHtml()}
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
  const subject = resolveInitialRsvpSubject(event);
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
          rsvpSubject: subject,
          date: event.date,
          description: event.description,
          rsvpMessage: (event as any).rsvpMessage,
          rsvpBgColor: (event as any).rsvpBgColor,
          rsvpAccentColor: (event as any).rsvpAccentColor,
          qrCodeBgColor: (event as any).qrCodeBgColor,
          qrCodeCenterColor: (event as any).qrCodeCenterColor,
          from: buildEventEmailFrom(event),
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
      subject,
      html,
      buildEventEmailFrom(event),
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
        buildEventEmailFrom(event),
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
    const summary = buildRsvpSummary(rsvps);
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
    const guestCount = normalizeGuestCount(req.body?.guestCount, 1);
    const tag = normalizeTag(req.body?.tag);

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
      guestCount,
      tag: tag || null,
      attendanceStatus: "pending",
      source: "imported",
      isEditable: true,
      qrCodeBgColor: (event as any).qrCodeBgColor,
      qrCodeCenterColor: (event as any).qrCodeCenterColor,
      qrCodeEdgeColor: (event as any).qrCodeEdgeColor,
    });

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
          guestCount: normalizeGuestCount(row.guestCount, 1),
          tag: normalizeTag(row.tag) || null,
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
    const { rsvpIds } = req.body || {};

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

    return res.status(400).json({
      message:
        "Direct RSVP email sending is disabled. Use the message builder to schedule RSVP emails.",
      total: Array.isArray(rsvpIds) ? rsvpIds.length : 0,
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

export const updateRsvpGuest = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const cleanedGuestName =
      typeof req.body?.guestName === "string" ? req.body.guestName.trim() : "";
    const cleanedEmail =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const cleanedPhone =
      typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const guestCount = normalizeGuestCount(req.body?.guestCount, 1);
    const tag = normalizeTag(req.body?.tag);
    const nextStatus =
      typeof req.body?.attendanceStatus === "string"
        ? req.body.attendanceStatus.trim().toLowerCase()
        : undefined;

    if (!cleanedGuestName) {
      return res.status(400).json({ message: "Guest name is required" });
    }

    const invitation = await InvitationRecord.findById(rsvpId);
    if (invitation) {
      invitation.guestName = cleanedGuestName;
      invitation.email = cleanedEmail || null;
      invitation.phone = cleanedPhone || null;
      await invitation.save();

      return res.json({ message: "Invitation guest updated", invitation });
    }

    const rsvp = await RSVP.findById(rsvpId);
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP guest not found" });
    }

    if (
      nextStatus !== undefined &&
      !["yes", "no", "pending"].includes(nextStatus)
    ) {
      return res.status(400).json({ message: "Invalid attendance status" });
    }

    rsvp.guestName = cleanedGuestName;
    rsvp.email = cleanedEmail || null;
    rsvp.phone = cleanedPhone || null;
    rsvp.guestCount = guestCount;
    rsvp.tag = tag || undefined;

    if (nextStatus !== undefined) {
      rsvp.attendanceStatus = nextStatus as AttendanceStatus;
      if (nextStatus === "pending") {
        (rsvp as any).submissionDate = null;
      } else if (!rsvp.submissionDate) {
        rsvp.submissionDate = new Date();
      }
    }

    await rsvp.save();

    return res.json({ message: "RSVP guest updated", rsvp });
  } catch (error: any) {
    console.error("updateRsvpGuest error", error);
    res
      .status(500)
      .json({ message: "Failed to update RSVP guest", error: error.message });
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
      "guestCount",
      "tag",
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
        getRsvpGuestWeight(r),
        r.tag || "",
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

    const token = generateRsvpToken(RSVP_FORM_TOKEN_BYTES);
    const slug = slugifyLinkTitle(
      req.body?.customLinkTitle || req.body?.customEventTitle || "",
    );
    const redirectUrl =
      typeof req.body?.redirectUrl === "string"
        ? req.body.redirectUrl.trim()
        : null;
    const link = await RSVPFormLink.create({
      eventId,
      token,
      slug: slug || null,
      redirectUrl: redirectUrl || null,
    });
    const baseUrl =
      req.body?.publicBaseUrl ||
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "";
    const relativePath = link.slug
      ? `/r/${link.slug}/${link.token}`
      : `/r/${link.token}`;

    return res.json({
      token: link.token,
      slug: link.slug || null,
      path: relativePath,
      url: baseUrl
        ? `${baseUrl.replace(/\/$/, "")}${relativePath}`
        : link.slug
          ? relativePath
          : link.token,
    });
  } catch (error: any) {
    console.error("generateRsvpFormLink error", error);
    res.status(500).json({ message: "Failed to generate RSVP form link" });
  }
};
