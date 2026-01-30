import { Request, Response } from "express";
import csv from "fast-csv";
import xlsx from "xlsx";
import { Readable } from "stream";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { RSVPFormLink } from "../models/rsvpFormLinkModel";
import { generateRsvpToken } from "../utils/rsvpToken";
import { sendEmail } from "../library/helpers/emailService";
import { invokeLambda } from "../utils/lambdaUtils";

type AttendanceStatus = "pending" | "yes" | "no";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "softinvites@gmail.com";

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
        .pipe(csv.parse({ headers: true }))
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
  rsvpId: string,
  baseUrl: string,
) {
  const headerBg = (event as any).qrCodeBgColor
    ? `rgb(${event.qrCodeBgColor})`
    : "#111827";
  const accent = (event as any).qrCodeCenterColor
    ? `rgb(${event.qrCodeCenterColor})`
    : "#111827";
  const yesUrl = `${baseUrl.replace(/\/$/, "")}/rsvp/respond/${rsvpId}?status=yes`;
  const noUrl = `${baseUrl.replace(/\/$/, "")}/rsvp/respond/${rsvpId}?status=no`;

  return `
    <div style="font-family:'Segoe UI','Arial',sans-serif;background:#f7f8fc;padding:24px 10px;line-height:1.6;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.08);">
        <div style="background:${headerBg};padding:24px 20px;text-align:center;color:#fff;">
          <h1 style="margin:0 0 6px 0;font-size:22px;">${event.name}</h1>
          <p style="margin:0;font-size:14px;">${event.date}</p>
        </div>
        <div style="padding:24px 20px;">
          <p style="font-size:15px;margin:0 0 16px 0;">Dear ${guestName},</p>
          <p style="font-size:14px;color:#4a5568;line-height:1.7;margin:0 0 20px 0;">
            ${event.description || "You're invited! Please let us know if you will attend."}
          </p>
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
          qrCodeBgColor: event.qrCodeBgColor,
          qrCodeCenterColor: event.qrCodeCenterColor,
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
    );
    sent += 1;
  }
  return { sent, skipped };
}

export const getRsvpGuests = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
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
    res.json({ rsvps, summary });
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

    const rsvp = await RSVP.create({
      eventId,
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

    const created: any[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (!row.guestName) {
        skipped += 1;
        continue;
      }
      const rsvp = await RSVP.create({
        eventId,
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

    const baseUrl =
      req.body?.publicBaseUrl ||
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "";
    if (baseUrl) {
      await sendRsvpEmailsBatch(event, created, baseUrl);
    }

    if (ADMIN_EMAIL) {
      await sendEmail(
        ADMIN_EMAIL,
        `RSVP import summary for ${event.name}`,
        `<p>Imported ${created.length} RSVP guests (skipped ${skipped}).</p>`,
      );
    }

    return res.json({
      message: "RSVP guest import completed",
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

    const baseUrl =
      publicBaseUrl ||
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "";
    if (!baseUrl) {
      return res.status(400).json({ message: "Missing public RSVP base URL" });
    }

    const filter: any = { eventId };
    if (Array.isArray(rsvpIds) && rsvpIds.length > 0) {
      filter._id = { $in: rsvpIds };
    }

    const rsvps = await RSVP.find(filter);
    const result = await sendRsvpEmailsBatch(event, rsvps as any, baseUrl);

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
    if (!deleted) {
      return res.status(404).json({ message: "RSVP guest not found" });
    }
    return res.json({ message: "RSVP guest deleted" });
  } catch (error: any) {
    console.error("deleteRsvpGuest error", error);
    res.status(500).json({ message: "Failed to delete RSVP guest" });
  }
};

export const exportRsvpCsv = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
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
