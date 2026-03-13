import { Request, Response } from "express";
import { Types } from "mongoose";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { RSVPFormLink } from "../models/rsvpFormLinkModel";
import { sendEmail } from "../library/helpers/emailService";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference";

type AttendanceStatus = "yes" | "no" | "pending";

type CustomFormField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "select" | "radio" | "checkbox" | "number";
  required: boolean;
  options: string[];
};

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "softinvites@gmail.com";

const SUPPORTED_CUSTOM_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "number",
]);

const normalizeCustomFormFields = (value: any): CustomFormField[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((field, index) => {
      const type = SUPPORTED_CUSTOM_FIELD_TYPES.has(field?.type)
        ? field.type
        : "text";
      const id =
        typeof field?.id === "string" && field.id.trim()
          ? field.id.trim()
          : `custom_field_${index + 1}`;
      return {
        id,
        label:
          typeof field?.label === "string" && field.label.trim()
            ? field.label.trim()
            : `Question ${index + 1}`,
        type,
        required: field?.required === true,
        options: Array.isArray(field?.options)
          ? field.options
              .map((option: any) => String(option || "").trim())
              .filter(Boolean)
          : [],
      } as CustomFormField;
    })
    .filter(Boolean);
};

const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeIcsText = (value: string) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const formatIcsDate = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};

const parseEventDate = (value: any): Date | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const cleaned = raw.replace(/(\d+)(st|nd|rd|th)/gi, "$1");
  const fallback = new Date(cleaned);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }

  return null;
};

const buildRequestOrigin = (req: Request) => {
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.get("host") || "";
  return `${protocol}://${host}`;
};

const sanitizeCalendarFilename = (value: string) =>
  String(value || "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "event";

const findRsvpByIdentifier = async (rsvpId: string) => {
  let rsvp = null;

  if (Types.ObjectId.isValid(rsvpId)) {
    rsvp = await RSVP.findById(rsvpId);
  }
  if (!rsvp) {
    rsvp = await RSVP.findOne({ token: rsvpId });
  }
  if (!rsvp && Types.ObjectId.isValid(rsvpId)) {
    rsvp = await RSVP.findOne({ guestId: rsvpId });
  }

  return rsvp;
};

export const getRsvpFormByToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const formLink = await RSVPFormLink.findOne({ token });
    if (!formLink) {
      return res.status(404).json({ message: "RSVP form link not found" });
    }

    const event = await Event.findById(formLink.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    if ((event as any).servicePackage === "invitation-only") {
      return res.status(400).json({ message: "RSVP is disabled for this event" });
    }

    return res.json({
      token,
      submitted: formLink.submitted,
      event: {
        id: event._id,
        name: event.name,
        date: event.date,
        location: (event as any).location,
        iv: (event as any).iv,
        description: (event as any).description,
        rsvpBgColor: (event as any).rsvpBgColor,
        rsvpAccentColor: (event as any).rsvpAccentColor,
        qrCodeBgColor: (event as any).qrCodeBgColor,
        qrCodeCenterColor: (event as any).qrCodeCenterColor,
        qrCodeEdgeColor: (event as any).qrCodeEdgeColor,
        rsvpFormSettings: (event as any).rsvpFormSettings,
        servicePackage: (event as any).servicePackage,
        channelConfig: (event as any).channelConfig,
      },
      form: {
        isEditable: false,
      },
    });
  } catch (error: any) {
    console.error("getRsvpFormByToken error", error);
    res.status(500).json({ message: "Failed to load RSVP form" });
  }
};

export const submitRsvpForm = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const formLink = await RSVPFormLink.findOne({ token });
    if (!formLink) {
      return res.status(404).json({ message: "RSVP form link not found" });
    }
    if (formLink.submitted) {
      return res.status(400).json({ message: "Form already submitted" });
    }

    const { guestName, email, phone, attendanceStatus, comments } = req.body;
    const cleanedGuestName = String(guestName || "").trim();
    const cleanedEmail = typeof email === "string" ? email.trim() : "";
    const cleanedPhone = typeof phone === "string" ? phone.trim() : "";
    const normalizedStatus = String(attendanceStatus || "")
      .trim()
      .toLowerCase();
    const cleanedComments =
      typeof comments === "string"
        ? comments
        : comments === null || comments === undefined
          ? ""
          : String(comments);

    const event = await Event.findById(formLink.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    const attendanceEnabled =
      (event as any)?.rsvpFormSettings?.attendanceEnabled !== false;
    if (!cleanedGuestName) {
      return res.status(400).json({ message: "Guest name is required" });
    }
    if (attendanceEnabled && !normalizedStatus) {
      return res
        .status(400)
        .json({ message: "Attendance status is required" });
    }
    if (attendanceEnabled && !["yes", "no"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "Invalid attendance status" });
    }
    const servicePackage =
      (event as any).servicePackage || "standard-rsvp";
    const trackingEnabled =
      (event as any)?.channelConfig?.email?.trackingEnabled !== false;
    const replyTo = (event as any)?.channelConfig?.email?.replyTo;
    if (servicePackage === "invitation-only") {
      return res
        .status(400)
        .json({ message: "RSVP is disabled for this event" });
    }
    const customFields = normalizeCustomFormFields(
      (event as any)?.rsvpFormSettings?.customFields,
    );
    const rawResponses =
      req.body?.responses && typeof req.body.responses === "object"
        ? req.body.responses
        : {};
    const cleanedResponses: Record<string, any> = {};
    for (const field of customFields) {
      const rawValue = rawResponses[field.id];
      if (field.type === "checkbox") {
        const values = Array.isArray(rawValue)
          ? rawValue
              .map((entry) => String(entry || "").trim())
              .filter(Boolean)
          : typeof rawValue === "string"
            ? rawValue
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean)
            : [];
        if (field.required && values.length === 0) {
          return res.status(400).json({ message: `${field.label} is required` });
        }
        if (
          values.length > 0 &&
          field.options.length > 0 &&
          values.some((value) => !field.options.includes(value))
        ) {
          return res.status(400).json({ message: `Invalid value for ${field.label}` });
        }
        cleanedResponses[field.id] = values;
        continue;
      }

      const value =
        rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
      if (field.required && !value) {
        return res.status(400).json({ message: `${field.label} is required` });
      }
      if (
        value &&
        (field.type === "select" || field.type === "radio") &&
        field.options.length > 0 &&
        !field.options.includes(value)
      ) {
        return res.status(400).json({ message: `Invalid value for ${field.label}` });
      }
      cleanedResponses[field.id] = value;
    }

    const rsvp = await RSVP.create({
      eventId: event._id,
      token: formLink.token,
      guestName: cleanedGuestName,
      email: cleanedEmail || null,
      phone: cleanedPhone || null,
      attendanceStatus: attendanceEnabled
        ? (normalizedStatus as AttendanceStatus)
        : "pending",
      comments: cleanedComments,
      responses: cleanedResponses,
      submissionDate: new Date(),
      source: "form_submission",
      isEditable: false,
      qrCodeBgColor: (event as any).qrCodeBgColor,
      qrCodeCenterColor: (event as any).qrCodeCenterColor,
      qrCodeEdgeColor: (event as any).qrCodeEdgeColor,
    });

    formLink.submitted = true;
    formLink.submittedAt = new Date();
    await formLink.save();

    // Save optional channel preferences if provided
    if (req.body?.preferredChannels || req.body?.whatsappOptIn || req.body?.smsOptIn) {
      const preferredChannels = Array.isArray(req.body.preferredChannels)
        ? req.body.preferredChannels
        : typeof req.body.preferredChannels === "string"
          ? req.body.preferredChannels.split(",").map((s: string) => s.trim()).filter(Boolean)
          : ["email"];
      await RSVPChannelPreference.findOneAndUpdate(
        { rsvpId: rsvp._id },
        {
          rsvpId: rsvp._id,
          preferredChannels,
          whatsappOptIn: !!req.body.whatsappOptIn,
          smsOptIn: !!req.body.smsOptIn,
          whatsappNumber: req.body.whatsappNumber || null,
          mobileNumber: req.body.mobileNumber || null,
          optInDate: new Date(),
        },
        { upsert: true, new: true },
      );
    }

    const emailJobs: Array<{
      label: string;
      promise: Promise<unknown>;
    }> = [];

    const sendGuestAck =
      servicePackage !== "one-time-rsvp" &&
      servicePackage !== "standard-rsvp" &&
      servicePackage !== "full-rsvp";

    if (cleanedEmail && sendGuestAck) {
      emailJobs.push({
        label: "guest",
        promise: sendEmail(
          cleanedEmail,
          `RSVP received for ${event.name}`,
          `<p>Thanks ${cleanedGuestName}, we have received your response for ${event.name}.</p>`,
          `SoftInvites <info@softinvite.com>`,
          undefined,
          {
            eventId: String(event._id),
            rsvpId: String(rsvp._id),
            messageType: "rsvp-ack",
            trackingEnabled,
            replyTo,
          },
        ),
      });
    }

    if (ADMIN_EMAIL) {
      emailJobs.push({
        label: "admin",
        promise: sendEmail(
          ADMIN_EMAIL,
          `New RSVP submission - ${event.name}`,
          `<p>${cleanedGuestName} responded: ${normalizedStatus}</p>`,
          undefined,
          undefined,
          {
            eventId: String(event._id),
            rsvpId: String(rsvp._id),
            messageType: "rsvp-admin-alert",
            trackingEnabled,
            replyTo,
          },
        ),
      });
    }

    if (emailJobs.length) {
      const results = await Promise.allSettled(
        emailJobs.map((job) => job.promise),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `submitRsvpForm email failed (${emailJobs[index].label})`,
            result.reason,
          );
        }
      });
    }

    return res.json({
      message: "RSVP submitted",
      rsvp: {
        id: rsvp._id,
        attendanceStatus: rsvp.attendanceStatus,
        submissionDate: rsvp.submissionDate,
      },
    });
  } catch (error: any) {
    console.error("submitRsvpForm error", error);
    res.status(500).json({ message: "Failed to submit RSVP form" });
  }
};

export const respondFromEmail = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const { status } = req.query as { status?: AttendanceStatus };
    if (!status || !["yes", "no"].includes(status)) {
      return res.status(400).send("Invalid status");
    }
    const update = { attendanceStatus: status, submissionDate: new Date() };
    let rsvp = null;

    if (Types.ObjectId.isValid(rsvpId)) {
      rsvp = await RSVP.findByIdAndUpdate(rsvpId, update, { new: true });
    }
    if (!rsvp) {
      rsvp = await RSVP.findOneAndUpdate({ token: rsvpId }, update, { new: true });
    }
    if (!rsvp && Types.ObjectId.isValid(rsvpId)) {
      rsvp = await RSVP.findOneAndUpdate({ guestId: rsvpId }, update, { new: true });
    }
    if (!rsvp) {
      return res.status(404).send("RSVP not found");
    }
    const event = await Event.findById(rsvp.eventId);
    const isYes = status === "yes";
    const accent = isYes ? "#2e7d32" : "#c62828";
    const bg = isYes ? "#e8f5e9" : "#ffebee";
    const title = isYes ? "You're confirmed!" : "We'll miss you!";
    const message = isYes
      ? "Thanks for confirming your attendance."
      : "Thanks for letting us know you can't make it.";
    const canAddToCalendar = isYes && !!event && !!parseEventDate((event as any).date);
    const calendarUrl =
      canAddToCalendar
        ? `${buildRequestOrigin(req)}/rsvp/${encodeURIComponent(String(rsvp._id))}/calendar`
        : "";
    const eventName = event?.name ? escapeHtml(String(event.name)) : "your event";

    return res.send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>RSVP Updated</title>
          <style>
            :root {
              color-scheme: light;
              --mui-bg: ${bg};
              --mui-accent: ${accent};
              --mui-text: #1f2937;
              --mui-muted: #6b7280;
              --mui-card: #ffffff;
              --mui-shadow: 0 10px 30px rgba(0,0,0,0.12);
            }
            body {
              margin: 0;
              background: var(--mui-bg);
              font-family: "Roboto", "Helvetica", "Arial", sans-serif;
              color: var(--mui-text);
            }
            .shell {
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
            }
            .card {
              width: 100%;
              max-width: 520px;
              background: var(--mui-card);
              border-radius: 18px;
              box-shadow: var(--mui-shadow);
              padding: 28px;
              text-align: center;
            }
            .badge {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              padding: 6px 12px;
              border-radius: 999px;
              font-size: 12px;
              font-weight: 600;
              color: var(--mui-accent);
              background: rgba(0,0,0,0.06);
              margin-bottom: 12px;
            }
            h1 {
              margin: 0 0 8px 0;
              font-size: 26px;
            }
            p {
              margin: 6px 0;
              color: var(--mui-muted);
              font-size: 15px;
            }
            .status {
              margin: 18px 0 20px 0;
              font-weight: 700;
              color: var(--mui-accent);
              font-size: 18px;
            }
            .actions {
              display: flex;
              justify-content: center;
              margin-top: 20px;
            }
            .button {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 12px 18px;
              border-radius: 999px;
              font-size: 14px;
              font-weight: 700;
              color: #ffffff;
              text-decoration: none;
              background: var(--mui-accent);
              box-shadow: 0 10px 24px rgba(0,0,0,0.16);
            }
            .button:hover {
              opacity: 0.92;
            }
            .helper {
              margin-top: 12px;
              font-size: 13px;
            }
          </style>
        </head>
        <body>
          <div class="shell">
            <div class="card">
              <div class="badge">RSVP Update</div>
              <h1>${title}</h1>
              <p>${message}</p>
              <p>${eventName}</p>
              <div class="status">Status: ${status.toUpperCase()}</div>
              ${
                canAddToCalendar && calendarUrl
                  ? `
                    <div class="actions">
                      <a class="button" href="${calendarUrl}">Add to Calendar</a>
                    </div>
                    <p class="helper">Optional: save this event to your calendar.</p>
                  `
                  : ""
              }
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("respondFromEmail error", error);
    res.status(500).send("Failed to update RSVP");
  }
};

export const downloadRsvpCalendarInvite = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const rsvp = await findRsvpByIdentifier(rsvpId);
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }

    const event = await Event.findById(rsvp.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const eventStart = parseEventDate((event as any).date);
    if (!eventStart) {
      return res.status(400).json({ message: "Event date is not valid for calendar export" });
    }

    const rawEndDate = parseEventDate((event as any).eventEndDate);
    const eventEnd =
      rawEndDate && rawEndDate.getTime() > eventStart.getTime()
        ? rawEndDate
        : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);

    const descriptionParts = [
      event.description ? String(event.description).trim() : "",
      event.location ? `Location: ${String(event.location).trim()}` : "",
    ].filter(Boolean);

    const calendarBody = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SoftInvites//RSVP Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:rsvp-${String(rsvp._id)}@softinvite.com`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(eventStart)}`,
      `DTEND:${formatIcsDate(eventEnd)}`,
      `SUMMARY:${escapeIcsText(String(event.name || "SoftInvites Event"))}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join("\n\n"))}`,
      `LOCATION:${escapeIcsText(String(event.location || ""))}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizeCalendarFilename(String(event.name || "event"))}.ics"`,
    );
    return res.send(calendarBody);
  } catch (error: any) {
    console.error("downloadRsvpCalendarInvite error", error);
    res.status(500).json({ message: "Failed to generate calendar invite" });
  }
};

const resolveRsvpByTokenOrId = async (idOrToken: string) => {
  if (Types.ObjectId.isValid(idOrToken)) {
    const byId = await RSVP.findById(idOrToken);
    if (byId) return byId;
  }
  const byToken = await RSVP.findOne({ token: idOrToken });
  if (byToken) return byToken;
  if (Types.ObjectId.isValid(idOrToken)) {
    const byGuest = await RSVP.findOne({ guestId: idOrToken });
    if (byGuest) return byGuest;
  }
  return null;
};

export const getRsvpPreferences = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const rsvp = await resolveRsvpByTokenOrId(token);
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }
    const prefs = await RSVPChannelPreference.findOne({ rsvpId: rsvp._id });
    return res.json({
      rsvpId: rsvp._id,
      guestName: rsvp.guestName,
      preferences: prefs || {
        preferredChannels: ["email"],
        whatsappOptIn: false,
        smsOptIn: false,
        whatsappNumber: null,
        mobileNumber: null,
      },
    });
  } catch (error: any) {
    console.error("getRsvpPreferences error", error);
    return res.status(500).json({ message: "Failed to load preferences" });
  }
};

export const updateRsvpPreferences = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const rsvp = await resolveRsvpByTokenOrId(token);
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }

    const preferredChannels = Array.isArray(req.body.preferredChannels)
      ? req.body.preferredChannels
      : typeof req.body.preferredChannels === "string"
        ? req.body.preferredChannels.split(",").map((s: string) => s.trim()).filter(Boolean)
        : ["email"];

    const prefs = await RSVPChannelPreference.findOneAndUpdate(
      { rsvpId: rsvp._id },
      {
        rsvpId: rsvp._id,
        preferredChannels,
        whatsappOptIn: !!req.body.whatsappOptIn,
        smsOptIn: !!req.body.smsOptIn,
        whatsappNumber: req.body.whatsappNumber || null,
        mobileNumber: req.body.mobileNumber || null,
        optInDate: new Date(),
      },
      { upsert: true, new: true },
    );

    return res.json({ message: "Preferences updated", preferences: prefs });
  } catch (error: any) {
    console.error("updateRsvpPreferences error", error);
    return res.status(500).json({ message: "Failed to update preferences" });
  }
};
