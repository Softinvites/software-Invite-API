import { Request, Response } from "express";
import { Types } from "mongoose";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { buildEventEmailFrom } from "../utils/emailSender";
import { MessageSchedule } from "../models/messageSchedule";
import { EmailTemplate } from "../models/emailTemplate";
import { Guest } from "../models/guestmodel";
import {
  resolveEventTimeOfDay,
  getEventUtcOffsetMinutes,
} from "../utils/eventTime";
import { RSVPFormLink } from "../models/rsvpFormLinkModel";
import { WhatsAppMessage } from "../models/WhatsAppMessage";
import { EmailMessage } from "../models/emailMessage";
import { sendEmail } from "../library/helpers/emailService";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference";

type AttendanceStatus = "yes" | "no" | "pending";

type CustomFormField = {
  id: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "select"
    | "radio"
    | "checkbox"
    | "number"
    | "email"
    | "phone"
    | "date"
    | "time"
    | "section";
  required: boolean;
  options: string[];
  /** "yes"/"no": only asked when the guest picked that attendance answer. */
  showWhen?: "always" | "yes" | "no";
};

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "softinvites@gmail.com";
const RSVP_FORM_INVALIDATED_MESSAGE =
  "This form is no longer receiving submissions";

const SUPPORTED_CUSTOM_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "number",
  "email",
  "phone",
  "date",
  "time",
  "section",
]);

const MAX_PLUS_ONES = 10;

const isRsvpFormClosed = (event: any) => {
  const settings = event?.rsvpFormSettings;
  if (!settings || typeof settings !== "object") return false;
  return (
    settings.isInvalidated === true ||
    settings.acceptingSubmissions === false
  );
};

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
        showWhen:
          field?.showWhen === "yes" || field?.showWhen === "no"
            ? field.showWhen
            : "always",
      } as CustomFormField;
    })
    .filter(Boolean);
};

const normalizeEmailAddress = (value: string) => String(value || "").trim().toLowerCase();

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

/**
 * Builds the UTC instant for an event from its calendar date plus an optional
 * Africa/Lagos time of day.
 *
 * parseEventDate returns a Date at LOCAL midnight, so reading it with UTC
 * getters shifted every event a day earlier on a server east of UTC
 * ("Saturday, October 3rd, 2026" came out as 2026-10-02). Reading the calendar
 * components with local getters and rebuilding explicitly keeps the date
 * correct regardless of the server's timezone.
 */
const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Extracts the calendar Y/M/D an admin actually meant.
 *
 * Event dates are free text and sometimes name a day the month does not have —
 * "31th November, 2026". `new Date` silently rolls that into December, so the
 * calendar invite landed on the wrong day (and the wrong month). Parsing the
 * parts ourselves lets us clamp the day to the end of the stated month, which
 * keeps the event in November where the admin put it.
 */
const parseEventDateParts = (
  value: any,
): { year: number; month: number; day: number } | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const cleaned = raw.replace(/(\d+)(st|nd|rd|th)/gi, "$1");
  const monthMatch = cleaned.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  );
  const yearMatch = cleaned.match(/\b(\d{4})\b/);
  const dayMatch = cleaned.match(/\b(\d{1,2})\b/);

  if (monthMatch && yearMatch && dayMatch) {
    const month = MONTH_INDEX[monthMatch[1].toLowerCase()];
    const year = Number(yearMatch[1]);
    const requestedDay = Number(dayMatch[1]);
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(Math.max(requestedDay, 1), daysInMonth);

    if (day !== requestedDay) {
      console.warn(
        `[Calendar] Event date "${raw}" names day ${requestedDay}, but that month has ` +
          `only ${daysInMonth}. Clamped to ${day} rather than rolling into the next month.`,
      );
    }
    return { year, month, day };
  }

  // No month name (ISO strings and similar) — fall back to native parsing,
  // reading local getters because that is how the value was constructed.
  const parsed = parseEventDate(raw);
  if (!parsed) return null;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth(),
    day: parsed.getDate(),
  };
};

const buildEventInstant = (
  dateValue: any,
  time: { hours: number; minutes: number } | null,
): Date | null => {
  const parts = parseEventDateParts(dateValue);
  if (!parts) return null;

  const { year, month, day } = parts;

  // No time recorded: keep it at UTC midnight of that calendar date so the
  // entry shows on the right day rather than slipping to the evening before.
  if (!time) return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

  // Wall-clock time is Africa/Lagos; convert to the UTC instant.
  return new Date(
    Date.UTC(year, month, day, time.hours, time.minutes, 0, 0) -
      getEventUtcOffsetMinutes() * 60 * 1000,
  );
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

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Recovers the current RSVP for a link whose record no longer exists.
 *
 * Deleting guests and re-importing them gives every guest a new _id, but the
 * WhatsApp/email links already delivered still carry the old one — those
 * guests got "RSVP not found" instead of their recorded response. The message
 * log keeps the old rsvpId with the phone/email it was sent to, so we can find
 * the same guest in the same event. Only an unambiguous single match is
 * returned; shared numbers or addresses are never guessed.
 */
const recoverRsvpFromMessageLog = async (rsvpId: string) => {
  if (!Types.ObjectId.isValid(rsvpId)) return null;

  const [waMessage, emailMessage] = await Promise.all([
    WhatsAppMessage.findOne({ rsvpId }).select({ eventId: 1, phoneNumber: 1 }).lean<any>(),
    EmailMessage.findOne({ rsvpId }).select({ eventId: 1, guestEmail: 1 }).lean<any>(),
  ]);

  const phoneDigits = String(waMessage?.phoneNumber || "").replace(/\D/g, "");
  if (waMessage?.eventId && phoneDigits.length >= 10) {
    const matches = await RSVP.find({
      eventId: waMessage.eventId,
      phone: new RegExp(`${escapeRegex(phoneDigits.slice(-10))}$`),
    }).limit(2);
    if (matches.length === 1) return matches[0];
  }

  const email = normalizeEmailAddress(emailMessage?.guestEmail || "");
  if (emailMessage?.eventId && email) {
    const matches = await RSVP.find({
      eventId: emailMessage.eventId,
      email: new RegExp(`^${escapeRegex(email)}$`, "i"),
    }).limit(2);
    if (matches.length === 1) return matches[0];
  }

  return null;
};

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
  if (!rsvp) {
    rsvp = await recoverRsvpFromMessageLog(rsvpId);
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
    if (isRsvpFormClosed(event)) {
      return res.status(410).json({ message: RSVP_FORM_INVALIDATED_MESSAGE });
    }

    return res.json({
      token,
      submitted: false,
      redirectUrl: formLink.redirectUrl || null,
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

    const { guestName, email, phone, attendanceStatus, comments } = req.body;
    const cleanedGuestName = String(guestName || "").trim();
    const cleanedEmail = normalizeEmailAddress(
      typeof email === "string" ? email : "",
    );
    const cleanedPhone = typeof phone === "string" ? phone.trim() : "";
    const cleanedSubmissionKey =
      typeof req.body?.submissionKey === "string"
        ? req.body.submissionKey.trim()
        : "";
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
    if (isRsvpFormClosed(event)) {
      return res.status(410).json({ message: RSVP_FORM_INVALIDATED_MESSAGE });
    }
    const attendanceEnabled =
      (event as any)?.rsvpFormSettings?.attendanceEnabled !== false;
    if (!cleanedGuestName) {
      return res.status(400).json({ message: "Guest name is required" });
    }
    // Email is optional: several guests legitimately share one address, and
    // some have none at all. The guest's name is the identity here.
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
      // Section headers carry no answer; conditional questions only count
      // when the guest gave the matching attendance answer.
      if (field.type === "section") continue;
      if (
        attendanceEnabled &&
        (field.showWhen === "yes" || field.showWhen === "no") &&
        normalizedStatus !== field.showWhen
      ) {
        continue;
      }
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
      if (value && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return res.status(400).json({ message: `Enter a valid email for ${field.label}` });
      }
      cleanedResponses[field.id] = value;
    }

    // Built-in fields: only enforced when the host explicitly made them
    // required, so forms saved before these settings existed behave as before.
    const formSettings = ((event as any)?.rsvpFormSettings || {}) as Record<string, any>;
    if (formSettings.emailMode === "required" && !cleanedEmail) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (formSettings.phoneMode === "required" && !cleanedPhone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    // Plus-ones: only when the host enabled them and the guest is attending
    // (or the form has no attendance question). Rows without a name are dropped.
    const plusOnesAllowed =
      formSettings.plusOnesEnabled === true &&
      (!attendanceEnabled || normalizedStatus === "yes");
    const plusOnesMax = Math.min(
      MAX_PLUS_ONES,
      Math.max(1, Number.parseInt(String(formSettings.plusOnesMax ?? MAX_PLUS_ONES), 10) || 1),
    );
    const cleanedPlusOnes = plusOnesAllowed && Array.isArray(req.body?.plusOnes)
      ? req.body.plusOnes
          .map((entry: any) => ({
            name: String(entry?.name || "").replace(/\s+/g, " ").trim().slice(0, 120),
            phone: String(entry?.phone || "").trim().slice(0, 40) || null,
            email: normalizeEmailAddress(String(entry?.email || "")).slice(0, 160) || null,
          }))
          .filter((entry: any) => entry.name)
      : [];
    if (cleanedPlusOnes.length > plusOnesMax) {
      return res
        .status(400)
        .json({ message: `You can add up to ${plusOnesMax} extra guest${plusOnesMax === 1 ? "" : "s"}` });
    }

    // Duplicate detection keys on the guest's NAME, not their email.
    // Families and couples routinely share one address, and keying on email
    // meant the first person to respond locked everyone else out of the form.
    if (cleanedSubmissionKey) {
      const normalizedName = cleanedGuestName
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const existingSubmission = await RSVP.findOne({
        eventId: event._id,
        source: "form_submission",
        formLinkToken: formLink.token,
        formResponseKey: cleanedSubmissionKey,
        guestName: { $regex: `^${escapedName}$`, $options: "i" },
      });
      if (existingSubmission) {
        return res.status(400).json({
          message:
            "This form has already been submitted on this device for this name. " +
            "If you are responding for someone else, enter their name instead.",
        });
      }
    }

    const rsvp = await RSVP.create({
      eventId: event._id,
      formLinkToken: formLink.token,
      formResponseKey: cleanedSubmissionKey || null,
      guestName: cleanedGuestName,
      email: cleanedEmail || null,
      phone: cleanedPhone || null,
      guestCount: 1 + cleanedPlusOnes.length,
      ...(cleanedPlusOnes.length ? { plusOnes: cleanedPlusOnes } : {}),
      tag: null,
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
          `<p>Thanks ${cleanedGuestName}, we have received your response for ${event.name}.</p>` +
            `<p style="font-size:12px;color:#718096;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px;">Sent by <strong>SoftInvites</strong> on behalf of your host. Look out for messages from SoftInvites for updates about this event.<br>&copy; ${new Date().getFullYear()} <strong>SoftInvites</strong> &bull; All rights reserved</p>`,
          buildEventEmailFrom(event),
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

/**
 * GET /rsvp/respond/:rsvpId — read-only.
 *
 * The Yes/No links in emails and WhatsApp messages are opened automatically
 * by mail security scanners (Outlook Safe Links, Proofpoint, Mimecast) and
 * link-preview fetchers. When this GET recorded the answer, those bots
 * silently RSVP'd guests — usually "yes", the first link — before the guest
 * ever tapped a button, and the one-click lock then blocked the real answer.
 * Opening the link now only shows a confirmation step; the answer is
 * recorded by confirmRsvpResponse (POST), which bots do not perform.
 */
export const respondFromEmail = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const { status } = req.query as { status?: AttendanceStatus };
    const format = (req.query.format as string | undefined) || '';
    if (!status || !["yes", "no"].includes(status)) {
      if (format === 'json') return res.status(400).json({ message: 'Invalid status' });
      return res.status(400).send("Invalid status");
    }

    const rsvp = await findRsvpByIdentifier(rsvpId);
    if (!rsvp) {
      if (format === 'json') return res.status(404).json({ message: 'RSVP not found' });
      return res.status(404).send("RSVP not found");
    }

    const event = await Event.findById(rsvp.eventId);

    // One-click lock: once a guest has responded yes/no, the response is
    // final and cannot be changed or re-submitted.
    const alreadyResponded =
      rsvp.attendanceStatus === "yes" || rsvp.attendanceStatus === "no";

    if (format === 'json') {
      return res.json({
        message: alreadyResponded ? 'Response already submitted' : 'Awaiting confirmation',
        alreadySubmitted: alreadyResponded,
        attendanceStatus: rsvp.attendanceStatus,
        eventName: event?.name || '',
        // Lets the client say WHOSE invitation this is, so someone who opened
        // a shared inbox knows they clicked the wrong invitation.
        guestName: toFirstName(rsvp.guestName),
        rsvpId: String(rsvp._id),
        hasEmail: !!rsvp.email,
        eventImage: event?.iv || '',
      });
    }

    if (alreadyResponded) {
      return res.send(
        buildAlreadySubmittedPage(rsvp.attendanceStatus, event, rsvp.guestName),
      );
    }

    return res.send(
      buildConfirmPromptPage(event, String(rsvp._id), rsvp.guestName, !rsvp.email),
    );
  } catch (error: any) {
    console.error("respondFromEmail error", error);
    res.status(500).send("Failed to load RSVP");
  }
};

// Conditional update so a double tap (or yes then no in two tabs) cannot
// overwrite the first recorded answer.
const recordFirstResponse = async (
  rsvp: any,
  status: AttendanceStatus,
  email?: string,
) => {
  const update: Record<string, any> = {
    attendanceStatus: status,
    submissionDate: new Date(),
  };
  if (email && !rsvp.email) update.email = email;

  const updated = await RSVP.findOneAndUpdate(
    { _id: rsvp._id, attendanceStatus: { $nin: ["yes", "no"] } },
    update,
    { new: true },
  );
  const finalRsvp = updated || (await RSVP.findById(rsvp._id));
  return {
    alreadySubmitted: !updated,
    finalRsvp,
    recordedStatus: finalRsvp?.attendanceStatus || status,
  };
};

/**
 * POST /rsvp/respond/:rsvpId — records the guest's answer after an explicit
 * button press. Accepts JSON (the web app) or a form post (the server-rendered
 * fallback page, which gets HTML back).
 */
export const confirmRsvpResponse = async (req: Request, res: Response) => {
  const wantsHtml = !req.is("application/json");
  try {
    const { rsvpId } = req.params;
    const { status, email } = (req.body || {}) as { status?: string; email?: string };
    if (!status || !["yes", "no"].includes(status)) {
      return wantsHtml
        ? res.status(400).send("Invalid status")
        : res.status(400).json({ message: "Invalid status" });
    }

    const rsvp = await findRsvpByIdentifier(rsvpId);
    if (!rsvp) {
      return wantsHtml
        ? res.status(404).send("RSVP not found")
        : res.status(404).json({ message: "RSVP not found" });
    }

    const cleanedEmail = normalizeEmailAddress(typeof email === "string" ? email : "");
    const { alreadySubmitted, finalRsvp, recordedStatus } = await recordFirstResponse(
      rsvp,
      status as AttendanceStatus,
      cleanedEmail,
    );
    const event = await Event.findById(rsvp.eventId);

    if (wantsHtml) {
      return res.send(
        alreadySubmitted
          ? buildAlreadySubmittedPage(recordedStatus, event, rsvp.guestName)
          : buildConfirmationPage(recordedStatus, event),
      );
    }
    return res.json({
      message: alreadySubmitted ? "Response already submitted" : "RSVP updated",
      alreadySubmitted,
      attendanceStatus: recordedStatus,
      eventName: event?.name || "",
      guestName: toFirstName(rsvp.guestName),
      rsvpId: String(rsvp._id),
      hasEmail: !!finalRsvp?.email,
    });
  } catch (error: any) {
    console.error("confirmRsvpResponse error", error);
    return wantsHtml
      ? res.status(500).send("Failed to update RSVP")
      : res.status(500).json({ message: "Failed to update RSVP" });
  }
};

/**
 * Records a tap on a WhatsApp quick-reply RSVP button and returns the text to
 * send back, or null if the payload is not an RSVP button.
 *
 * WhatsApp sends a tap on a template's header image to the template's first
 * URL, and that cannot be turned off, so with URL buttons the image opens the
 * "Yes" link. Quick-reply templates have no URL for the image to open. Their
 * button id carries the same `<rsvpId>?status=yes` value the URL buttons use
 * (rsvp_yes_link / rsvp_no_link), which also keeps guests who share a phone
 * number apart.
 *
 * The id grants what the public POST /rsvp/respond/:rsvpId already grants, so
 * this does not depend on the Twilio signature check passing.
 */
// Compare phones by their last 10 digits so "+234…", "234…" and "0…" match.
const phoneTail = (value: unknown) => String(value ?? "").replace(/\D/g, "").slice(-10);
const samePhone = (a: unknown, b: unknown) => {
  const x = phoneTail(a);
  return x.length >= 7 && x === phoneTail(b);
};

const statusFromButtonText = (text: string): AttendanceStatus | null => {
  const t = text.toLowerCase();
  if (/\b(unable|not|no|decline|can'?t|cannot|regret)\b/.test(t)) return "no";
  if (/\b(yes|will attend|attending|accept)\b/.test(t)) return "yes";
  return null;
};

/**
 * Records a WhatsApp quick-reply tap and returns the text to reply with, or
 * null to send no reply. The guest is identified from the message they
 * replied to (OriginalRepliedMessageSid -> our WhatsAppMessage log), which is
 * exact even if a template's button IDs are static. A button-ID token is only
 * trusted when that RSVP's phone matches the sender, so one guest can never
 * see or change another guest's (or another event's) response.
 */
export const respondFromWhatsAppButton = async (
  body: Record<string, any>,
): Promise<string | null> => {
  const payload = String(body?.ButtonPayload || "").trim();
  const buttonText = String(body?.ButtonText || "").trim();
  if (!payload && !buttonText) return null;

  const sender = body?.WaId || body?.From || "";
  // The Button ID may be the bare variable or the full respond URL around it.
  const match = /^(?:\S*\/)?([^/?\s]+)\?status=(yes|no)$/.exec(payload);
  const status: AttendanceStatus | null =
    (match?.[2] as AttendanceStatus) || statusFromButtonText(buttonText || payload);

  try {
    let rsvp: any = null;
    let source = "";

    const repliedSid = String(body?.OriginalRepliedMessageSid || "").trim();
    if (repliedSid) {
      const sent: any = await WhatsAppMessage.findOne({ providerMessageId: repliedSid })
        .select({ rsvpId: 1, guestId: 1 })
        .lean();
      if (sent?.rsvpId) rsvp = await RSVP.findById(sent.rsvpId);
      if (!rsvp && sent?.guestId) rsvp = await RSVP.findOne({ guestId: sent.guestId });
      if (rsvp) source = "replied-message";
    }

    if (!rsvp && match) {
      const candidate = await findRsvpByIdentifier(match[1]);
      if (candidate) {
        rsvp = candidate;
        source = "button-id";
      }
    }

    // Never act on an RSVP that does not belong to the person who tapped.
    if (rsvp && rsvp.phone && !samePhone(rsvp.phone, sender)) {
      console.warn("[WhatsAppButton] RSVP phone does not match sender - ignored", {
        rsvpId: String(rsvp._id),
        source,
        repliedSid: repliedSid || null,
      });
      return null;
    }
    if (!rsvp || !rsvp.phone || !status) {
      console.warn("[WhatsAppButton] Could not match tap to an RSVP - no reply sent", {
        source: source || null,
        hasStatus: !!status,
        repliedSid: repliedSid || null,
      });
      return null;
    }

    const { alreadySubmitted, recordedStatus } = await recordFirstResponse(rsvp, status);
    const event = await Event.findById(rsvp.eventId);
    const eventName = event?.name || "the event";
    console.log("[WhatsAppButton] Response handled", {
      rsvpId: String(rsvp._id),
      eventId: String(rsvp.eventId),
      source,
      status,
      alreadySubmitted,
    });

    if (alreadySubmitted) {
      const recorded = recordedStatus === "yes" ? "YES — Attending" : "NO — Unable to attend";
      return `A response to ${eventName} has already been recorded for ${toFirstName(rsvp.guestName) || "this invitation"}: ${recorded}. RSVP responses are final. If this is a mistake, please contact the event host.`;
    }
    return status === "yes"
      ? `Thank you! Your attendance at ${eventName} has been confirmed.`
      : `Thank you for letting us know you can't make it to ${eventName}.`;
  } catch (error: any) {
    console.error("respondFromWhatsAppButton error", error);
    return "Sorry, we could not record your response. Please tap the button again.";
  }
};

export const respondFromWhatsAppWithEmail = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const { status, email } = req.body as { status?: string; email?: string };

    if (!status || !["yes", "no"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    // Optional — the response is keyed to this specific RSVP record, so a
    // shared or missing address never blocks or overwrites another guest.
    const cleanedEmail = normalizeEmailAddress(typeof email === "string" ? email : "");

    // Load the RSVP first so we can honor the one-click lock.
    let rsvp = await findRsvpByIdentifier(rsvpId);
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }

    const alreadyResponded =
      rsvp.attendanceStatus === "yes" || rsvp.attendanceStatus === "no";

    // If already responded, the status is locked — only the email is saved
    // (this POST also doubles as the "add your email" step). The recorded
    // status is never overwritten.
    const update: Record<string, any> = {};
    if (cleanedEmail) update.email = cleanedEmail;
    if (!alreadyResponded) {
      update.attendanceStatus = status as AttendanceStatus;
      update.submissionDate = new Date();
    }

    rsvp = await RSVP.findByIdAndUpdate(rsvp._id, update, { new: true });
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }

    const event = await Event.findById(rsvp.eventId);
    return res.json({
      message: alreadyResponded ? "Response already submitted" : "RSVP updated",
      alreadySubmitted: alreadyResponded,
      attendanceStatus: rsvp.attendanceStatus,
      eventName: event?.name || "",
      rsvpId: String(rsvp._id),
    });
  } catch (error: any) {
    console.error("respondFromWhatsAppWithEmail error", error);
    res.status(500).json({ message: "Failed to update RSVP" });
  }
};

function buildConfirmPromptPage(
  event: any,
  rsvpId: string,
  guestName?: string | null,
  askEmail?: boolean,
): string {
  const eventName = event?.name ? escapeHtml(String(event.name)) : "the event";
  const cleanName = escapeHtml(toFirstName(guestName));
  const action = `/rsvp/respond/${encodeURIComponent(rsvpId)}`;
  const emailField = askEmail
    ? `<input type="email" name="email" placeholder="Email for event updates (optional)" />`
    : "";
  const image = event?.iv
    ? `<img src="${escapeHtml(String(event.iv))}" alt="Invitation" style="width:100%;border-radius:12px;margin-bottom:16px;" />`
    : "";
  const choice = (value: string, label: string, color: string) => `
    <form method="POST" action="${action}">
      <input type="hidden" name="status" value="${value}" />
      ${emailField}
      <button type="submit" style="background:${color};">${label}</button>
    </form>`;

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>Confirm your RSVP</title>
        <style>
          body { margin:0; background:#f0f4f8; font-family:"Roboto","Helvetica","Arial",sans-serif; color:#1f2937; }
          .shell { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
          .card { width:100%; max-width:480px; background:#fff; border-radius:18px; box-shadow:0 10px 30px rgba(0,0,0,0.12); padding:32px; text-align:center; }
          h1 { margin:0 0 8px 0; font-size:22px; }
          p { margin:6px 0 20px 0; color:#6b7280; font-size:15px; }
          form { margin:0 0 12px 0; }
          input { width:100%; box-sizing:border-box; padding:12px 16px; border:1.5px solid #d1d5db; border-radius:10px; font-size:15px; margin-bottom:8px; }
          button { width:100%; padding:13px; border:none; border-radius:10px; color:#fff; font-size:15px; font-weight:700; cursor:pointer; }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="card">
            ${image}
            <h1>Will you attend?</h1>
            <p>${cleanName ? `Hi <strong>${cleanName}</strong>, please` : "Please"} choose your response for <strong>${eventName}</strong>. Responses are final once submitted.</p>
            ${choice("yes", "✅ YES, I WILL ATTEND", "#2e7d32")}
            ${choice("no", "❌ UNABLE TO ATTEND", "#c62828")}
          </div>
        </div>
      </body>
    </html>
  `;
}

function buildConfirmationPage(status: string, event: any): string {
  const isYes = status === "yes";
  const accent = isYes ? "#2e7d32" : "#c62828";
  const bg = isYes ? "#e8f5e9" : "#ffebee";
  const title = isYes ? "You're confirmed!" : "We'll miss you!";
  const message = isYes
    ? "Thanks for confirming your attendance."
    : "Thanks for letting us know you can't make it.";
  const eventName = event?.name ? escapeHtml(String(event.name)) : "your event";
  const canAddToCalendar = isYes && !!event && !!parseEventDate(event?.date);
  const calendarUrl = canAddToCalendar
    ? `/rsvp/${encodeURIComponent(String(event._id))}/calendar`
    : "";

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>RSVP Updated</title>
        <style>
          :root { color-scheme: light; --mui-bg: ${bg}; --mui-accent: ${accent}; --mui-text: #1f2937; --mui-muted: #6b7280; --mui-card: #ffffff; --mui-shadow: 0 10px 30px rgba(0,0,0,0.12); }
          body { margin:0; background:var(--mui-bg); font-family:"Roboto","Helvetica","Arial",sans-serif; color:var(--mui-text); }
          .shell { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
          .card { width:100%; max-width:520px; background:var(--mui-card); border-radius:18px; box-shadow:var(--mui-shadow); padding:28px; text-align:center; }
          .badge { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:600; color:var(--mui-accent); background:rgba(0,0,0,0.06); margin-bottom:12px; }
          h1 { margin:0 0 8px 0; font-size:26px; }
          p { margin:6px 0; color:var(--mui-muted); font-size:15px; }
          .status { margin:18px 0 20px 0; font-weight:700; color:var(--mui-accent); font-size:18px; }
          .actions { display:flex; justify-content:center; margin-top:20px; }
          .button { display:inline-flex; align-items:center; justify-content:center; padding:12px 18px; border-radius:999px; font-size:14px; font-weight:700; color:#ffffff; text-decoration:none; background:var(--mui-accent); box-shadow:0 10px 24px rgba(0,0,0,0.16); }
          .button:hover { opacity:0.92; }
          .helper { margin-top:12px; font-size:13px; }
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
                ? `<div class="actions"><a class="button" href="${calendarUrl}">Add to Calendar</a></div><p class="helper">Optional: save this event to your calendar.</p>`
                : ""
            }
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Reduces a guest name to a recognisable first name for the "already
 * submitted" page, so the reader can tell whose link they opened without the
 * page disclosing a full identity.
 *
 * Real guest lists are messy — "Mr. & Mrs. Obinna Nwankiti",
 * "Akinyele, MRS. Oyindamola Christiana", "Lara Are - Guest 2",
 * "(Mother-in-law) Grandma Theresa Anosike" — so naive first-token splitting
 * yields "Mr." or "Akinyele,". Titles and list suffixes are stripped, and
 * anything that resolves to nothing useful falls back to the cleaned name.
 */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "professor", "chief", "alhaji",
  "alhaja", "engr", "engineer", "rev", "reverend", "ven", "pastor", "sir",
  "lady", "gen", "general", "capt", "captain", "barr", "barrister", "arc",
  "architect", "hon", "honourable", "sen", "senator", "and", "the",
  // military / service ranks
  "rear", "admiral", "col", "colonel", "maj", "major", "lt", "lieutenant",
  "sgt", "sergeant", "brig", "brigadier", "cdr", "commander", "cpt",
  // family relations, which guest lists use as prefixes
  "uncle", "aunty", "aunt", "auntie", "grandma", "grandpa", "granny",
  "mama", "papa", "bro", "brother", "sis", "sister",
]);

const toFirstName = (fullName?: string | null): string => {
  let name = String(fullName || "")
    .replace(/\([^)]*\)/g, " ")               // "(Mother-in-law)"
    .replace(/\s*[-–]\s*guest\s*\d+\s*$/i, "") // "- Guest 2"
    .replace(/\s*\+\s*\d+\s*$/, "")           // "+1"
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return "";

  // "Surname, Title Given" — the given name follows the comma.
  if (name.includes(",")) {
    const after = name.split(",").slice(1).join(" ").trim();
    if (after) name = after;
  }

  // Couples share one record; there is no single first name to show.
  if (/\s(&|\band\b)\s/i.test(name)) return name;

  for (const token of name.split(" ")) {
    const bare = token.replace(/[.]/g, "").toLowerCase();
    if (!bare || HONORIFICS.has(bare)) continue;
    return token.replace(/[,]+$/, "");
  }
  return name;
};

function buildAlreadySubmittedPage(
  status: string,
  event: any,
  guestName?: string | null,
): string {
  const isYes = status === "yes";
  const accent = isYes ? "#2e7d32" : "#c62828";
  const eventName = event?.name ? escapeHtml(String(event.name)) : "your event";
  const recorded = isYes ? "YES — Attending" : "NO — Unable to attend";

  // Households routinely share one inbox, so both invitations land together
  // and it is easy to open the wrong message. Naming the guest this link
  // belongs to turns a dead end into something the reader can act on.
  const cleanName = escapeHtml(toFirstName(guestName));
  const whoLine = cleanName
    ? `<p>This invitation link belongs to <strong>${cleanName}</strong>.</p>`
    : "";
  const wrongPersonNote = cleanName
    ? `<p class="note">Responding for someone else? Each guest has their own
         invitation link. Open the message addressed to them and use the buttons
         in that message — a link that has already been used cannot be reused.</p>`
    : `<p class="note">RSVP responses are final and cannot be changed. If this is
         a mistake, please contact the event host.</p>`;

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Response Already Submitted</title>
        <style>
          :root { color-scheme: light; }
          body { margin:0; background:#f0f4f8; font-family:"Roboto","Helvetica","Arial",sans-serif; color:#1f2937; }
          .shell { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
          .card { width:100%; max-width:520px; background:#ffffff; border-radius:18px; box-shadow:0 10px 30px rgba(0,0,0,0.12); padding:32px 28px; text-align:center; }
          .icon { width:72px; height:72px; border-radius:50%; background:${accent}; color:#fff; font-size:32px; display:flex; align-items:center; justify-content:center; margin:0 auto 16px; }
          h1 { margin:0 0 8px 0; font-size:24px; }
          p { margin:6px 0; color:#6b7280; font-size:15px; }
          .status { margin:18px 0 8px 0; font-weight:700; color:${accent}; font-size:18px; }
          .note { margin-top:14px; font-size:13px; color:#9ca3af; }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="card">
            <div class="icon">🔒</div>
            <h1>Response already submitted</h1>
            ${whoLine}
            <p>A response to <strong>${eventName}</strong> has already been recorded for this link.</p>
            <div class="status">Recorded response: ${recorded}</div>
            ${wrongPersonNote}
          </div>
        </div>
      </body>
    </html>
  `;
}

export const downloadRsvpCalendarInvite = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;

    // Try to find by RSVP first, then fall back to treating the param as an event ID
    const rsvp = await findRsvpByIdentifier(rsvpId);
    let event: any = null;

    if (rsvp) {
      event = await Event.findById(rsvp.eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
    } else {
      // Caller may have passed an event ID directly (legacy buildConfirmationPage behaviour)
      if (Types.ObjectId.isValid(rsvpId)) {
        event = await Event.findById(rsvpId);
      }
      if (!event) {
        return res.status(404).json({ message: "RSVP not found" });
      }
    }

    if (!parseEventDate((event as any).date)) {
      return res.status(400).json({ message: "Event date is not valid for calendar export" });
    }

    // The event model has no time field — admins type the time into a template
    // variable or a "Time:" line in a message body. Without this the calendar
    // invite defaulted to midnight UTC, which guests saw as 1-3am locally.
    // The guest's own invitation message is the email body they actually
    // received, so it outranks event-level sources.
    let guestMessage: string | null = null;
    if (rsvp?.guestId) {
      try {
        const guest = await Guest.findById(rsvp.guestId).select({ message: 1 }).lean();
        guestMessage = (guest as any)?.message || null;
      } catch {
        /* best effort */
      }
    }

    const timeOfDay = await resolveEventTimeOfDay(event, MessageSchedule, {
      EmailTemplateModel: EmailTemplate,
      extraSources: [guestMessage, (rsvp as any)?.comments],
    });

    // Date comes from event.date; time (when recorded anywhere) is Lagos local.
    const eventStart = buildEventInstant((event as any).date, timeOfDay)!;

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
      `UID:rsvp-${rsvp ? String(rsvp._id) : String(event._id)}@softinvite.com`,
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

    // Most guests open RSVP links inside WhatsApp's in-app browser, which
    // ignores Content-Disposition for text/calendar and renders the .ics as
    // plain text. ?format=google sidesteps that entirely by handing the guest
    // to Google Calendar, which every webview can open.
    if (String(req.query.format || "").toLowerCase() === "google") {
      const googleUrl =
        "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        `&text=${encodeURIComponent(String(event.name || "SoftInvites Event"))}` +
        `&dates=${formatIcsDate(eventStart)}/${formatIcsDate(eventEnd)}` +
        `&details=${encodeURIComponent(descriptionParts.join("\n\n"))}` +
        `&location=${encodeURIComponent(String(event.location || ""))}`;
      return res.redirect(302, googleUrl);
    }

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
  return recoverRsvpFromMessageLog(idOrToken);
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
