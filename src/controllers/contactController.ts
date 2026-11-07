import { Request, Response } from "express";
import Joi from "joi";
import sanitizeHtml from "sanitize-html";
import { ContactMessage } from "../models/contactMessage";
import { sendEmail } from "../library/helpers/emailService";

/**
 * Enquiries submitted from the public marketing website (softinvite.com/contact).
 *
 * Public:  POST /contact                — submit an enquiry
 * Admin:   GET/PATCH/DELETE /contact/*  — inbox, read in Softinvites-website-QR
 */

/**
 * Every email leaves from info@softinvite.com — that is the sending identity.
 * ADMIN_INBOX is only a notification recipient; nothing is ever sent *from* it.
 */
const MAIL_FROM = process.env.CONTACT_FROM_EMAIL || "SoftInvites <info@softinvite.com>";
const REPLY_FROM = process.env.CONTACT_REPLY_FROM_EMAIL || MAIL_FROM;
const ADMIN_INBOX = process.env.CONTACT_INBOX_EMAIL || "softinvites@gmail.com";

const submissionSchema = Joi.object({
  name: Joi.string().trim().min(2).max(200).required(),
  email: Joi.string().trim().email({ tlds: { allow: false } }).max(320).required(),
  phone: Joi.string().trim().allow("").max(40),
  eventType: Joi.string().trim().min(2).max(200).required(),
  eventDate: Joi.string().trim().allow("").max(40),
  location: Joi.string().trim().allow("").max(200),
  guestCount: Joi.string().trim().allow("").max(40),
  services: Joi.array().items(Joi.string().trim().max(200)).max(20).default([]),
  message: Joi.string().trim().allow("").max(5000),
  // Honeypot: a hidden field real people never fill in.
  company: Joi.string().allow("").max(200),
});

/** Strips all markup — these values are rendered into an HTML email. */
const clean = (value?: string) =>
  sanitizeHtml(value || "", { allowedTags: [], allowedAttributes: {} }).trim();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function buildNotificationEmail(doc: {
  name: string;
  email: string;
  phone?: string;
  eventType: string;
  eventDate?: string;
  location?: string;
  guestCount?: string;
  services: string[];
  message?: string;
  createdAt: Date;
}) {
  const row = (label: string, value?: string) =>
    value
      ? `<tr>
           <td style="padding:10px 0;border-bottom:1px solid #eae0d2;color:#8a8072;font-size:12px;letter-spacing:.08em;text-transform:uppercase;width:170px;vertical-align:top;">${label}</td>
           <td style="padding:10px 0;border-bottom:1px solid #eae0d2;color:#2c2721;font-size:15px;">${escapeHtml(value)}</td>
         </tr>`
      : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fbf8f3;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf8f3;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #eae0d2;">
          <tr>
            <td style="padding:28px 32px;border-bottom:1px solid #eae0d2;">
              <p style="margin:0;color:#b08d57;font-size:11px;letter-spacing:.22em;text-transform:uppercase;">New Website Enquiry</p>
              <h1 style="margin:10px 0 0;color:#1f1b16;font-size:26px;font-weight:normal;">${escapeHtml(doc.name)}</h1>
              <p style="margin:6px 0 0;color:#6b6154;font-size:14px;">${escapeHtml(doc.eventType)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${row("Email", doc.email)}
                ${row("Phone", doc.phone)}
                ${row("Event type", doc.eventType)}
                ${row("Event date", doc.eventDate)}
                ${row("Location", doc.location)}
                ${row("Approx. guests", doc.guestCount)}
                ${row("Services", doc.services.join(", "))}
                ${row("Submitted", doc.createdAt.toUTCString())}
              </table>
              ${
                doc.message
                  ? `<div style="margin-top:24px;padding:18px 20px;background:#fbf8f3;border-left:2px solid #b08d57;">
                       <p style="margin:0 0 8px;color:#8a8072;font-size:11px;letter-spacing:.16em;text-transform:uppercase;">Message</p>
                       <p style="margin:0;color:#2c2721;font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(doc.message)}</p>
                     </div>`
                  : ""
              }
              <p style="margin:28px 0 0;color:#8a8072;font-size:13px;line-height:1.6;">
                Reply directly to this email to reach ${escapeHtml(doc.name)} &mdash; the reply-to address is set to
                <a href="mailto:${escapeHtml(doc.email)}" style="color:#937548;">${escapeHtml(doc.email)}</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:#fbf8f3;border-top:1px solid #eae0d2;">
              <p style="margin:0;color:#a99f90;font-size:12px;">
                Sent from softinvite.com &mdash; view all enquiries in the SoftInvites dashboard under Enquiries.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/* -------------------------------------------------------------- public --- */

export const submitContactMessage = async (req: Request, res: Response) => {
  try {
    const { error, value } = submissionSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      res.status(400).json({
        message: "Please check the details you entered.",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
      return;
    }

    // Honeypot tripped — accept silently so bots don't learn anything.
    if (value.company) {
      res.status(201).json({ message: "Thank you — your enquiry has been received." });
      return;
    }

    const payload = {
      name: clean(value.name),
      email: clean(value.email).toLowerCase(),
      phone: clean(value.phone),
      eventType: clean(value.eventType),
      eventDate: clean(value.eventDate),
      location: clean(value.location),
      guestCount: clean(value.guestCount),
      services: (value.services || []).map((s: string) => clean(s)).filter(Boolean),
      message: clean(value.message),
      source: "website",
      ipAddress:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    };

    const record = await ContactMessage.create(payload);

    // Persist first, notify second. A mail failure must never lose the enquiry.
    try {
      await sendEmail(
        ADMIN_INBOX,
        `New website enquiry — ${record.name} (${record.eventType})`,
        buildNotificationEmail(record),
        MAIL_FROM,
        undefined,
        {
          replyTo: record.email,
          messageType: "contact-enquiry",
          // This is an internal ops notification, not a campaign — no open/click
          // pixels, and no link rewriting inside it.
          trackingEnabled: false,
        },
      );
      record.notified = true;
      record.notificationError = null;
    } catch (mailError: any) {
      console.error("Contact enquiry notification failed:", mailError);
      record.notified = false;
      record.notificationError = String(mailError?.message || mailError).slice(0, 500);
    }
    await record.save();

    res.status(201).json({
      message: "Thank you — your enquiry has been received.",
      id: record._id,
    });
  } catch (err) {
    console.error("submitContactMessage error:", err);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
};

/* --------------------------------------------------------------- admin --- */

export const listContactMessages = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const { status, search } = req.query as { status?: string; search?: string };

    const filter: Record<string, any> = {};
    if (status && status !== "all") filter.status = status;
    if (search) {
      const term = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { name: term },
        { email: term },
        { eventType: term },
        { location: term },
        { message: term },
      ];
    }

    const [messages, total, statusCounts] = await Promise.all([
      ContactMessage.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ContactMessage.countDocuments(filter),
      ContactMessage.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const counts = statusCounts.reduce(
      (acc: Record<string, number>, row: { _id: string; count: number }) => {
        acc[row._id] = row.count;
        return acc;
      },
      { new: 0, read: 0, responded: 0, archived: 0 },
    );

    res.status(200).json({
      messages,
      counts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("listContactMessages error:", err);
    res.status(500).json({ message: "Failed to load enquiries" });
  }
};

export const getContactMessage = async (req: Request, res: Response) => {
  try {
    const record = await ContactMessage.findById(req.params.id);
    if (!record) {
      res.status(404).json({ message: "Enquiry not found" });
      return;
    }

    // Opening an unread enquiry marks it read.
    if (record.status === "new") {
      record.status = "read";
      await record.save();
    }

    res.status(200).json({ message: record });
  } catch (err) {
    console.error("getContactMessage error:", err);
    res.status(500).json({ message: "Failed to load enquiry" });
  }
};

/**
 * Internal notes only. `status` is deliberately NOT accepted — it is driven by
 * what actually happens: opening an enquiry marks it read, sending a reply
 * marks it responded. A hand-set status would just drift from reality.
 */
export const updateContactMessage = async (req: Request, res: Response) => {
  try {
    const schema = Joi.object({
      adminNotes: Joi.string().allow("").max(5000),
    }).min(1);

    const { error, value } = schema.validate(req.body, { stripUnknown: true });
    if (error) {
      res.status(400).json({ message: error.message });
      return;
    }

    const record = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      { $set: value },
      { new: true },
    );

    if (!record) {
      res.status(404).json({ message: "Enquiry not found" });
      return;
    }

    res.status(200).json({ message: "Enquiry updated", data: record });
  } catch (err) {
    console.error("updateContactMessage error:", err);
    res.status(500).json({ message: "Failed to update enquiry" });
  }
};

/** Branded reply, sent to the enquirer from info@softinvite.com. */
function buildReplyEmail(name: string, body: string, originalMessage?: string) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 16px;color:#2c2721;font-size:15px;line-height:1.75;">${escapeHtml(
          para,
        ).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fbf8f3;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf8f3;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #eae0d2;">
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:1px solid #eae0d2;">
              <p style="margin:0;font-family:Georgia,serif;font-size:24px;color:#1f1b16;">Soft<em>Invites</em></p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 18px;color:#2c2721;font-size:15px;line-height:1.75;">Dear ${escapeHtml(name)},</p>
              ${paragraphs}
              <p style="margin:24px 0 0;color:#2c2721;font-size:15px;line-height:1.75;">
                Warm regards,<br />The SoftInvites Team
              </p>
            </td>
          </tr>
          ${
            originalMessage
              ? `<tr>
                   <td style="padding:0 32px 28px;">
                     <div style="padding:16px 18px;background:#fbf8f3;border-left:2px solid #d9cbb6;">
                       <p style="margin:0 0 8px;color:#a99f90;font-size:11px;letter-spacing:.16em;text-transform:uppercase;">Your original enquiry</p>
                       <p style="margin:0;color:#6b6154;font-size:13px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(originalMessage)}</p>
                     </div>
                   </td>
                 </tr>`
              : ""
          }
          <tr>
            <td style="padding:18px 32px;background:#fbf8f3;border-top:1px solid #eae0d2;">
              <p style="margin:0;color:#a99f90;font-size:12px;line-height:1.7;">
                SoftInvites &middot; 56 Moshalashi Street, Shomolu, Lagos, Nigeria<br />
                WhatsApp +234 812 877 4556 &middot; <a href="https://www.softinvite.com" style="color:#937548;">softinvite.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export const replyToContactMessage = async (req: Request, res: Response) => {
  try {
    const schema = Joi.object({
      body: Joi.string().trim().min(1).max(10000).required(),
      subject: Joi.string().trim().max(300).allow(""),
      includeOriginal: Joi.boolean().default(true),
    });

    const { error, value } = schema.validate(req.body, { stripUnknown: true });
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const record = await ContactMessage.findById(req.params.id);
    if (!record) {
      res.status(404).json({ message: "Enquiry not found" });
      return;
    }

    const subject =
      clean(value.subject) || `Re: your ${record.eventType} enquiry — SoftInvites`;
    const body = clean(value.body);

    try {
      await sendEmail(
        record.email,
        subject,
        buildReplyEmail(
          record.name,
          body,
          value.includeOriginal ? record.message : undefined,
        ),
        REPLY_FROM,
        undefined,
        { messageType: "contact-reply", trackingEnabled: false },
      );
    } catch (mailError: any) {
      const message = String(mailError?.message || mailError);
      console.error("Contact reply failed:", mailError);

      // Record the attempt so the dashboard can show what went wrong.
      record.replies.push({
        body,
        subject,
        sentAt: new Date(),
        sentBy: (req as any).admin?._id,
        delivered: false,
        error: message.slice(0, 500),
      });
      await record.save();

      res.status(502).json({ message: `Could not send the reply: ${message}` });
      return;
    }

    record.replies.push({
      body,
      subject,
      sentAt: new Date(),
      sentBy: (req as any).admin?._id,
      delivered: true,
      error: null,
    });
    record.lastRepliedAt = new Date();
    record.status = "responded";
    await record.save();

    res.status(200).json({ message: "Reply sent", data: record });
  } catch (err) {
    console.error("replyToContactMessage error:", err);
    res.status(500).json({ message: "Failed to send reply" });
  }
};

export const deleteContactMessage = async (req: Request, res: Response) => {
  try {
    const record = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!record) {
      res.status(404).json({ message: "Enquiry not found" });
      return;
    }
    res.status(200).json({ message: "Enquiry deleted" });
  } catch (err) {
    console.error("deleteContactMessage error:", err);
    res.status(500).json({ message: "Failed to delete enquiry" });
  }
};

export const exportContactMessages = async (_req: Request, res: Response) => {
  try {
    const records = await ContactMessage.find().sort({ createdAt: -1 }).lean();

    const header = [
      "Submitted",
      "Name",
      "Email",
      "Phone",
      "Event Type",
      "Event Date",
      "Location",
      "Guests",
      "Services",
      "Message",
      "Status",
    ];

    const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

    const rows = records.map((r: any) =>
      [
        new Date(r.createdAt).toISOString(),
        r.name,
        r.email,
        r.phone,
        r.eventType,
        r.eventDate,
        r.location,
        r.guestCount,
        (r.services || []).join("; "),
        r.message,
        r.status,
      ]
        .map(cell)
        .join(","),
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="softinvites-enquiries-${new Date().toISOString().split("T")[0]}.csv"`,
    );
    res.status(200).send([header.map(cell).join(","), ...rows].join("\n"));
  } catch (err) {
    console.error("exportContactMessages error:", err);
    res.status(500).json({ message: "Failed to export enquiries" });
  }
};
