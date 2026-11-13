import { MessageSchedule } from "../models/messageSchedule.js";
import { Event } from "../models/eventmodel.js";
import { buildEventEmailFrom } from "../utils/emailSender.js";
import { RSVP } from "../models/rsvpmodel.js";
import { sendEmail } from "../library/helpers/emailService.js";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference.js";
import whatsappService from "../utils/whatsappService.js";
import smsService from "../utils/smsService.js";
import { EmailTemplate } from "../models/emailTemplate.js";
import { WhatsAppTemplate } from "../models/whatsappTemplate.js";
import { WhatsAppContentTemplate } from "../models/whatsappContentTemplate.js";
import { RSVPFormLink } from "../models/rsvpFormLinkModel.js";
import {
  buildDynamicTemplateParams,
  resolveExternalFormUrl,
  applyHeaderMediaDefaults,
  VariableDefinition,
} from "../utils/dynamicTemplateBuilder.js";
import fetch from "node-fetch";
import crypto from "crypto";

const HARDCODED_SCHEDULER_TEMPLATE_PATTERNS = [
  /^event_invitation/i,
  /^event_reminder/i,
  /^event_details_reminder/i,
  /^rsvp_party/i,
  /^rsvp_wedding/i,
  /^rsvp_form/i,
  /^rsvp_followup/i,
  /^logistics/i,
  /^wedding_invite/i,
  /^event_pass/i,
];

const isHardcodedSchedulerTemplate = (templateName: string) =>
  HARDCODED_SCHEDULER_TEMPLATE_PATTERNS.some((rx) =>
    rx.test(templateName || ""),
  );

const generateRsvpToken = (bytes = 16) =>
  crypto.randomBytes(bytes).toString("base64url");

export type SchedulerRunOptions = {
  limit?: number;
  now?: Date;
};

export type SchedulerRunSummary = {
  scanned: number;
  processed: number;
  sent: number;
  failed: number;
  pendingRetried: number;
};

const DEFAULT_ATTENDANCE_LABEL = "Will you attend?";
const DEFAULT_ATTENDANCE_YES_LABEL = "YES, I WILL ATTEND";
const DEFAULT_ATTENDANCE_NO_LABEL = "UNABLE TO ATTEND";

const normalizeTargetAudience = (target: string) => {
  if (target === "non-responders") return "pending";
  if (target === "pending-no" || target === "pending_and_no") {
    return "pending-and-no";
  }
  if (
    target === "all" ||
    target === "responders" ||
    target === "yes" ||
    target === "no" ||
    target === "pending" ||
    target === "pending-and-no" ||
    target === "tag"
  ) {
    return target;
  }
  return "all";
};

const normalizeTargetTag = (value?: string | null) => {
  const trimmed = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed || null;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildExactTagPattern = (value: string) =>
  new RegExp(
    `^\\s*${value.split(" ").map(escapeRegex).join("\\s+")}\\s*$`,
    "i",
  );

const resolveAudienceFilter = (target: string, targetTag?: string | null) => {
  const normalizedTarget = normalizeTargetAudience(target);
  if (normalizedTarget === "pending") {
    return { attendanceStatus: "pending" };
  }
  if (normalizedTarget === "responders") {
    return { attendanceStatus: { $in: ["yes", "no"] } };
  }
  if (normalizedTarget === "yes") {
    return { attendanceStatus: "yes" };
  }
  if (normalizedTarget === "no") {
    return { attendanceStatus: "no" };
  }
  if (normalizedTarget === "pending-and-no") {
    return { attendanceStatus: { $in: ["pending", "no"] } };
  }
  if (normalizedTarget === "tag") {
    const normalizedTag = normalizeTargetTag(targetTag);
    return normalizedTag
      ? { tag: buildExactTagPattern(normalizedTag) }
      : { _id: null };
  }
  return {};
};

const applyTemplateTokens = (html: string, event: any, rsvp: any) =>
  html
    .replace(/{{\s*guestName\s*}}/g, rsvp.guestName || "")
    .replace(/{{\s*eventName\s*}}/g, event.name || "")
    .replace(/{{\s*eventDate\s*}}/g, event.date || "");

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildDefaultScheduleMessage = (event: any, rsvp: any, schedule: any) => {
  let message =
    (event as any).rsvpMessage || event.description || "You're invited!";
  if (schedule.messageType === "reminder") {
    message = `Reminder: ${message}`;
  } else if (schedule.messageType === "thankyou") {
    message =
      rsvp.attendanceStatus === "yes"
        ? "Thanks for confirming! We look forward to seeing you."
        : "Thank you for your response.";
  } else if (schedule.messageType === "custom" && schedule.messageName) {
    message = `${schedule.messageName}: ${message}`;
  }
  return message;
};

const hasExplicitScheduleBody = (schedule: any) =>
  typeof schedule?.messageBody === "string" &&
  schedule.messageBody.trim().length > 0;

const requiresExplicitScheduleBody = (schedule: any) =>
  schedule?.servicePackage === "full-rsvp" ||
  schedule?.messageType === "custom";

const hasExplicitTime = (value: string) =>
  /\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i.test(value);

const IMAGE_ATTACHMENT_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const isImageAttachmentUrl = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /\.(png|jpe?g|webp|gif)([?#].*)?$/i.test(raw);
};

const resolveWhatsAppHeaderMediaUrl = (attachment: any) => {
  const url = String(attachment?.url || "").trim();
  if (!url) return "";

  const contentType = String(attachment?.contentType || "")
    .trim()
    .toLowerCase();
  if (contentType && IMAGE_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
    return url;
  }

  return isImageAttachmentUrl(url) ? url : "";
};

const getDefaultWhatsAppTemplateName = () =>
  (
    process.env.RSVP_WHATSAPP_TEMPLATE_NAME ||
    process.env.WHATSAPP_DEFAULT_TEMPLATE ||
    (process.env.TWILIO_ACCOUNT_SID
      ? process.env.TWILIO_DEFAULT_TEMPLATE_NAME ||
        (String(process.env.TWILIO_CONTENT_SID_WEDDING_INVITE || "").trim()
          ? "wedding_invite"
          : String(process.env.TWILIO_CONTENT_SID_RSVP_FOLLOWUP || "").trim()
            ? "rsvp_followup"
            : String(
                  process.env.TWILIO_CONTENT_SID_EVENT_DETAILS_REMINDER || "",
                ).trim()
              ? "event_details_reminder"
              : String(process.env.TWILIO_CONTENT_SID_LOGISTICS || "").trim()
                ? "logistics"
                : "event_pass")
      : "event_invitation")
  ).trim();

type WhatsAppTemplateVariableOverrides = Record<string, string>;

const normalizeTemplateVariableOverrides = (
  input: unknown,
): WhatsAppTemplateVariableOverrides => {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const normalized: WhatsAppTemplateVariableOverrides = {};

  for (const [key, value] of Object.entries(raw)) {
    const index = Number.parseInt(key, 10);
    if (!Number.isInteger(index) || index <= 0) continue;

    const trimmed =
      typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (!trimmed) continue;

    normalized[String(index)] = trimmed;
  }

  return normalized;
};

const applyTemplateVariableOverrides = (
  params: string[],
  overrides: unknown,
): string[] => {
  const normalized = normalizeTemplateVariableOverrides(overrides);
  const entries = Object.entries(normalized);
  if (!entries.length) return params;

  let next = [...params];
  for (const [key, value] of entries) {
    const index = Number.parseInt(key, 10);
    if (!Number.isInteger(index) || index <= 0) continue;

    const targetIndex = index - 1;
    if (targetIndex >= next.length) continue;
    next[targetIndex] = value;
  }

  return next;
};

const getPassUrlVariableIndex = () => {
  const rawValue = process.env.TWILIO_WHATSAPP_PASS_URL_VAR_INDEX;
  if (!rawValue) return 8;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
};

const getTemplateSpecificPassUrlMode = (templateName?: string) => {
  const normalizedTemplate = String(templateName || "")
    .toLowerCase()
    .trim();
  const envKey = templateName
    ? `TWILIO_WHATSAPP_PASS_URL_MODE_${String(templateName || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")}`
    : "";

  const templateOverride = envKey ? String(process.env[envKey] || "") : "";
  const templateOverrideTrimmed = templateOverride.toLowerCase().trim();
  if (templateOverrideTrimmed) return templateOverrideTrimmed;

  if (
    normalizedTemplate === "rsvp_followup" ||
    normalizedTemplate === "wedding_invite" ||
    normalizedTemplate === "event_pass"
  ) {
    return "qr_email_png_suffix";
  }

  const globalConfigured = String(
    process.env.TWILIO_WHATSAPP_PASS_URL_MODE || "",
  );
  const globalTrimmed = globalConfigured.toLowerCase().trim();
  if (globalTrimmed) return globalTrimmed;

  return "full_url";
};

const normalizePassUrlVariableValue = (
  passUrl?: string | null,
  templateName?: string,
) => {
  if (!passUrl) return "";
  const mode = getTemplateSpecificPassUrlMode(templateName);
  if (mode === "full_url") return passUrl;

  const markers = ["qr_codes/email_png/", "qr_codes/png/"];

  try {
    const url = new URL(passUrl);
    const normalizedPath = url.pathname.replace(/^\/+/, "");
    if (mode === "path") return normalizedPath;
    if (mode === "qr_email_png_suffix") {
      for (const marker of markers) {
        const idx = normalizedPath.indexOf(marker);
        if (idx >= 0) return normalizedPath.slice(idx + marker.length);
      }
      return normalizedPath;
    }
    return normalizedPath;
  } catch {
    const trimmed = String(passUrl || "").replace(/^\/+/, "");
    if (mode === "path") return trimmed;
    if (mode === "qr_email_png_suffix") {
      for (const marker of markers) {
        const idx = trimmed.indexOf(marker);
        if (idx >= 0) return trimmed.slice(idx + marker.length);
      }
      return trimmed;
    }
    return passUrl;
  }
};

// Helper to normalize header media URL (extract path after domain)
const normalizeHeaderMediaVariableValue = (
  mediaUrl?: string | null,
): string => {
  if (!mediaUrl) return "";
  try {
    const url = new URL(mediaUrl);
    const rawPath = url.pathname.replace(/^\/+/, "");
    return rawPath
      .split("/")
      .map((segment: string) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/");
  } catch {
    const raw = String(mediaUrl || "")
      .replace(/^\/+/, "")
      .trim();
    return raw
      .split("/")
      .map((segment: string) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/");
  }
};

const formatWhatsAppEventDateTime = (rawValue?: string | null) => {
  const fallbackTime = process.env.TWILIO_WHATSAPP_TIME_FALLBACK || "TBA";
  if (!rawValue) return { dateLabel: "TBA", timeLabel: fallbackTime };

  const trimmed = String(rawValue).trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return {
      dateLabel: trimmed,
      timeLabel: hasExplicitTime(trimmed) ? trimmed : fallbackTime,
    };
  }

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);

  const timeLabel =
    hasExplicitTime(trimmed) ||
    parsed.getHours() !== 0 ||
    parsed.getMinutes() !== 0
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(parsed)
      : fallbackTime;

  return { dateLabel, timeLabel };
};

const resolveEventPassHeaderValue = ({
  templateName,
  headerValue,
  eventName,
  eventIv,
  passUrl,
}: {
  templateName: string;
  headerValue?: string | null;
  eventName: string;
  eventIv?: string | null;
  passUrl?: string | null;
}) => {
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }
  return eventName || "Our Event";
};

const buildEventPassTemplateParams = ({
  templateName,
  event,
  rsvp,
  passUrl,
  headerValue,
}: {
  templateName: string;
  event: any;
  rsvp: any;
  passUrl?: string;
  headerValue?: string | null;
}) => {
  const { dateLabel, timeLabel } = formatWhatsAppEventDateTime(
    event?.date || "",
  );
  const passUrlVariableIndex = getPassUrlVariableIndex();
  const minLength = Math.max(8, passUrlVariableIndex);
  const params = Array.from({ length: minLength }, () => "");

  params[0] = resolveEventPassHeaderValue({
    templateName,
    headerValue: headerValue || null,
    eventName: event?.name || "Our Event",
    eventIv: event?.iv || null,
    passUrl: passUrl || null,
  });
  params[1] = rsvp?.guestName || "Guest";
  params[2] = event?.name || "Our Event";
  params[3] = event?.location || "Location";
  params[4] = dateLabel;
  params[5] = timeLabel;
  params[6] = "SoftInvites";
  if (passUrl) {
    params[passUrlVariableIndex - 1] = normalizePassUrlVariableValue(
      passUrl,
      templateName,
    );
  }
  return params;
};

const buildWeddingInviteTemplateParams = ({
  event,
  rsvp,
  passUrl,
  templateVariables,
}: {
  event: any;
  rsvp: any;
  passUrl?: string;
  templateVariables?: WhatsAppTemplateVariableOverrides | null;
}) => {
  const { dateLabel, timeLabel } = formatWhatsAppEventDateTime(
    event?.date || "",
  );

  // Normalize the header media (variable 10) – extract just the path after the bucket domain
  const headerMediaKey = normalizeHeaderMediaVariableValue(event?.iv || "");

  // Guard: {{10}} MUST be a real S3 path from event.iv.
  if (!headerMediaKey) {
    console.error(
      `[Scheduler] wedding_invite requires event.iv to be set on event ${event?._id}. ` +
        "Upload an invitation image when creating/updating the event.",
    );
    return null;
  }

  // Normalize the pass URL (variable 11) – extract the suffix after "qr_codes/email_png/"
  const passSuffix = normalizePassUrlVariableValue(
    passUrl || "",
    "wedding_invite",
  );

  // 11 variables – Twilio requires all to be non-empty strings
  const params = Array.from({ length: 11 }, () => "");
  params[0] = templateVariables?.["1"] || event?.name || "Our Event"; // {{1}}  event title
  params[1] = rsvp?.guestName || "Guest"; // {{2}}  guest name (AUTO – locked)
  params[2] = templateVariables?.["3"] || event?.name || "Our Family"; // {{3}}  host/family name
  params[3] = templateVariables?.["4"] || event?.name || "Our Event"; // {{4}}  ceremony type
  params[4] = templateVariables?.["5"] || event?.name || "the couple"; // {{5}}  couple names
  params[5] = templateVariables?.["6"] || "Ceremony"; // {{6}}  ceremony label
  params[6] = templateVariables?.["7"] || dateLabel || "TBA"; // {{7}}  date (frontend editable)
  params[7] = templateVariables?.["8"] || timeLabel || "TBA"; // {{8}}  time (frontend editable)
  params[8] = templateVariables?.["9"] || event?.location || "TBA"; // {{9}}  venue (frontend editable)
  params[9] = headerMediaKey || "WhatsApp+Image+2026-04-21+at+08.19.49.jpeg"; // {{10}} S3 image path (AUTO – locked)
  params[10] = passSuffix || "missing.png"; // {{11}} pass URL suffix (AUTO – locked)

  // Lock only AUTO variables: 2 (guest name), 10 (image), 11 (pass)
  const filtered = { ...templateVariables };
  delete filtered?.["2"];
  delete filtered?.["10"];
  delete filtered?.["11"];

  return applyTemplateVariableOverrides(params, filtered);
};

const buildSchedulerWhatsAppTemplateParams = ({
  templateName,
  event,
  rsvp,
  passUrl,
  headerValue,
  templateVariables,
  customDefinition,
}: {
  templateName: string;
  event: any;
  rsvp: any;
  passUrl?: string | null;
  headerValue?: string | null;
  templateVariables?: WhatsAppTemplateVariableOverrides | null;
  customDefinition?: VariableDefinition[] | null;
}) => {
  const { dateLabel, timeLabel } = formatWhatsAppEventDateTime(
    event?.date || "",
  );

  // Data-driven path: an approved Manager template (customDefinition) wins,
  // even over a hardcoded template of the same name. No definition supplied
  // → hardcoded branches below run unchanged.
  if (Array.isArray(customDefinition) && customDefinition.length > 0) {
    return buildDynamicTemplateParams(
      customDefinition,
      {
        recipientName: rsvp?.guestName || "Guest",
        eventName: event?.name || "Our Event",
        location: event?.location || "TBA",
        dateLabel,
        timeLabel,
        signoff: event?.name || "SoftInvites",
        eventIv: event?.iv || null,
        passUrl: passUrl || null,
      },
      templateVariables || null,
    );
  }

  // Helper: get user-provided value for a variable index, or fall back to auto value.
  // Locked variables always use the auto value regardless of what the user provided.
  const v = (
    index: number,
    autoValue: string,
    locked = false,
  ): string => {
    if (locked) return autoValue;
    const userValue = templateVariables?.[String(index)];
    return userValue && String(userValue).trim() ? String(userValue).trim() : autoValue;
  };

  if (
    /^event_details_reminder/i.test(templateName) ||
    /^event_reminder/i.test(templateName)
  ) {
    return [
      v(1, rsvp?.guestName || "Guest", true),   // locked: guest name
      v(2, event?.name || "Our Event"),           // user-editable
      v(3, event?.location || "TBA"),             // user-editable
      v(4, dateLabel),                            // user-editable
      v(5, timeLabel),                            // user-editable
    ];
  }

  if (/^rsvp_party/i.test(templateName)) {
    const rsvpId = String(rsvp?._id || rsvp?.token || "");
    const headerMediaKey = normalizeHeaderMediaVariableValue(event?.iv || "");
    return [
      v(1, event?.name || "Our Event"),           // user-editable
      v(2, rsvp?.guestName || "Guest", true),     // locked: guest name
      v(3, event?.name || "Our Event"),           // user-editable
      v(4, dateLabel),                            // user-editable
      v(5, timeLabel),                            // user-editable
      v(6, event?.location || "TBA"),             // user-editable
      v(7, headerMediaKey || "WhatsApp+Image+2026-04-21+at+08.19.49.jpeg", true), // locked
      v(8, rsvpId ? `${rsvpId}?status=yes` : " ", true), // locked
      v(9, rsvpId ? `${rsvpId}?status=no` : " ", true),  // locked
    ];
  }

  if (/^rsvp_wedding/i.test(templateName)) {
    const rsvpId = String(rsvp?._id || rsvp?.token || "");
    const headerMediaKey = normalizeHeaderMediaVariableValue(event?.iv || "");
    return [
      v(1, event?.name || "Our Event"),           // user-editable
      v(2, rsvp?.guestName || "Guest", true),     // locked: guest name
      v(3, event?.name || "Our Family"),          // user-editable
      v(4, event?.name || "Our Event"),           // user-editable
      v(5, event?.name || "the couple"),          // user-editable
      v(6, dateLabel),                            // user-editable
      v(7, timeLabel),                            // user-editable
      v(8, event?.location || "TBA"),             // user-editable
      v(9, headerMediaKey || "WhatsApp+Image+2026-04-21+at+08.19.49.jpeg", true), // locked
      v(10, rsvpId ? `${rsvpId}?status=yes` : " ", true), // locked
      v(11, rsvpId ? `${rsvpId}?status=no` : " ", true),  // locked
    ];
  }

  if (/^rsvp_form/i.test(templateName)) {
    const headerMediaKey = normalizeHeaderMediaVariableValue(event?.iv || "");
    return [
      v(1, event?.name || "Our Event"),          // user-editable: event title
      v(2, rsvp?.guestName || "Guest", true),    // locked: guest name
      v(3, event?.name || "Our Event"),          // user-editable: event title (auto-synced from 1)
      v(4, dateLabel),                           // user-editable: date
      v(5, timeLabel),                           // user-editable: time
      v(6, event?.location || "TBA"),            // user-editable: venue
      v(7, headerMediaKey || " ", true),         // locked: S3 image key
      v(8, passUrl || " ", true),               // locked: RSVP form token
    ];
  }

  if (/^rsvp_followup/i.test(templateName)) {
    return [
      v(1, rsvp?.guestName || "Guest", true),    // locked: guest name
      v(2, event?.name || "Our Event"),           // user-editable
      v(3, event?.location || "TBA"),             // user-editable
      v(4, dateLabel),                            // user-editable
      v(5, timeLabel),                            // user-editable
      v(6, normalizePassUrlVariableValue(passUrl || "", templateName), true), // locked
    ];
  }

  if (/^logistics/i.test(templateName)) {
    return [
      v(1, rsvp?.guestName || "Guest", true),    // locked: guest name
      v(2, event?.name || "Our Event"),           // user-editable
    ];
  }

  if (/^wedding_invite/i.test(templateName)) {
    return buildWeddingInviteTemplateParams({
      event,
      rsvp,
      passUrl: passUrl || "",
      templateVariables,
    });
  }

  if (/^event_pass/i.test(templateName)) {
    const params = buildEventPassTemplateParams({
      templateName,
      event,
      rsvp,
      passUrl: passUrl || "",
      headerValue: headerValue || null,
    });
    return applyTemplateVariableOverrides(params, templateVariables);
  }

  // Fallback: prefer user-provided values, auto-fill the rest
  return [
    v(1, rsvp?.guestName || "Guest"),
    v(2, event?.name || "Our Event"),
    v(3, event?.location || "TBA"),
    v(4, event?.date || "TBA"),
    v(5, passUrl || ""),
  ];
};

const resolveScheduleBody = (
  schedule: any,
  event: any,
  rsvp: any,
  templateHtml?: string | null,
) => {
  if (hasExplicitScheduleBody(schedule)) {
    return applyTemplateTokens(schedule.messageBody, event, rsvp);
  }
  if (templateHtml && templateHtml.trim()) {
    return applyTemplateTokens(templateHtml, event, rsvp);
  }
  if (requiresExplicitScheduleBody(schedule)) {
    return "";
  }
  return applyTemplateTokens(
    buildDefaultScheduleMessage(event, rsvp, schedule),
    event,
    rsvp,
  );
};

const buildScheduleTextMessage = (
  schedule: any,
  event: any,
  rsvp: any,
  templateHtml?: string | null,
) => stripHtml(resolveScheduleBody(schedule, event, rsvp, templateHtml));

const inferAttachmentFilename = (url: string, contentType?: string | null) => {
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").pop() || "";
    if (raw) return decodeURIComponent(raw);
  } catch {
    // fallback below
  }

  const extension =
    contentType === "application/pdf"
      ? "pdf"
      : contentType?.includes("png")
        ? "png"
        : contentType?.includes("jpeg")
          ? "jpg"
          : contentType?.includes("html")
            ? "html"
            : "bin";
  return `attachment.${extension}`;
};

const resolveScheduleAttachment = async (schedule: any) => {
  const url =
    typeof schedule?.attachment?.url === "string"
      ? schedule.attachment.url.trim()
      : "";
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Attachment fetch failed (${response.status})`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    const detectedType = response.headers.get("content-type");
    const contentType =
      (typeof schedule?.attachment?.contentType === "string" &&
        schedule.attachment.contentType.trim()) ||
      detectedType ||
      "application/octet-stream";
    const filename =
      (typeof schedule?.attachment?.filename === "string" &&
        schedule.attachment.filename.trim()) ||
      inferAttachmentFilename(url, contentType);

    return { filename, content, contentType };
  } catch (error) {
    console.error("Failed to resolve schedule attachment:", error);
    return null;
  }
};

// Image attachments are shown at the top of the email body (like the guest
// access-code email) instead of as a file; other files (e.g. PDF) stay attached.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)(\?|#|$)/i;
const scheduleInlineImageUrl = (schedule: any): string => {
  const url = typeof schedule?.attachment?.url === "string" ? schedule.attachment.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return "";
  const type = String(schedule?.attachment?.contentType || "").toLowerCase();
  return type.startsWith("image/") || (!type && IMAGE_EXT.test(url)) ? url : "";
};
const escapeAttr = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Branded footer: tells guests to look out for SoftInvites messages.
const softInvitesFooterHtml = () => `
        <div style="background:#f7f8fc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="font-size:12px;color:#718096;margin:0 0 6px 0;">Sent by <strong style="color:#4a5568;">SoftInvites</strong> on behalf of your host. Look out for messages from SoftInvites for updates about this event.</p>
          <p style="font-size:12px;color:#718096;margin:0;">&copy; ${new Date().getFullYear()} <strong style="color:#4a5568;">SoftInvites</strong> &bull; All rights reserved</p>
        </div>`;

const buildScheduleEmailHtml = async (
  event: any,
  rsvp: any,
  schedule: any,
  baseUrl: string,
  templateHtml?: string | null,
  inlineImageUrl = "",
) => {
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
  const safeBase =
    typeof baseUrl === "string" ? baseUrl.replace(/\/$/, "") : "";
  const attendanceEnabled =
    schedule?.includeResponseButtons !== false && Boolean(safeBase);
  const yesUrl = attendanceEnabled
    ? `${safeBase}/rsvp/respond/${rsvp._id}?status=yes`
    : "";
  const noUrl = attendanceEnabled
    ? `${safeBase}/rsvp/respond/${rsvp._id}?status=no`
    : "";

  const title =
    schedule.messageTitle ||
    schedule.messageName ||
    schedule.messageType ||
    "RSVP Update";
  const message = resolveScheduleBody(schedule, event, rsvp, templateHtml);

  const buttons =
    schedule.messageType === "thankyou" || !yesUrl || !noUrl
      ? ""
      : `
        <p style="font-size:14px;margin:0 0 12px 0;">${DEFAULT_ATTENDANCE_LABEL}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
          <a href="${yesUrl}" style="display:inline-block;background:${headerBg};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${DEFAULT_ATTENDANCE_YES_LABEL}</a>
          <a href="${noUrl}" style="display:inline-block;background:${accent};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${DEFAULT_ATTENDANCE_NO_LABEL}</a>
        </div>`;

  return `
    <div style="font-family:'Segoe UI','Arial',sans-serif;background:#f7f8fc;padding:24px 10px;line-height:1.6;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.08);">
        <div style="background:${headerBg};padding:24px 20px;text-align:center;color:#fff;">
          <h1 style="margin:0 0 6px 0;font-size:22px;">${event.name}</h1>
          <p style="margin:0;font-size:14px;">${event.date}</p>
        </div>
        <div style="padding:24px 20px;">
          ${inlineImageUrl ? `<div style="margin:0 0 20px 0;text-align:center;"><img src="${escapeAttr(inlineImageUrl)}" alt="Invitation" style="display:block;width:100%;max-width:600px;height:auto;margin:0 auto;border-radius:12px;border:0;" /></div>` : ""}
          <p style="font-size:15px;margin:0 0 16px 0;">Dear ${rsvp.guestName},</p>
          <div style="font-size:14px;color:#4a5568;line-height:1.7;margin:0 0 20px 0;">
            ${message}
          </div>
          ${buttons}
        </div>
        ${softInvitesFooterHtml()}
      </div>
    </div>
  `;
};

const canUseChannel = async (rsvpId: string, channel: string, event?: any) => {
  // Respect event-level channel config first
  if (channel === "email") {
    const emailEnabled = event?.channelConfig?.email?.enabled !== false;
    if (!emailEnabled) return false;
    return true;
  }
  if (channel === "whatsapp") {
    const waEnabled = event?.channelConfig?.whatsapp?.enabled !== false;
    if (!waEnabled) return false;
    // Check per-rsvp opt-in only if optInRequired is true
    const optInRequired =
      event?.channelConfig?.whatsapp?.optInRequired === true;
    if (!optInRequired) return true;
    const prefs = await RSVPChannelPreference.findOne({ rsvpId });
    return prefs?.whatsappOptIn === true;
  }
  if (channel === "bulkSms") {
    const smsEnabled = event?.channelConfig?.bulkSms?.enabled !== false;
    if (!smsEnabled) return false;
    const optInRequired = event?.channelConfig?.bulkSms?.optInRequired === true;
    if (!optInRequired) return true;
    const prefs = await RSVPChannelPreference.findOne({ rsvpId });
    return prefs?.smsOptIn === true;
  }
  return true;
};

/**
 * How many recipients to dispatch at once.
 *
 * Evidence from this account: Full (non-trial) Twilio account, observed median
 * gap between sends of ~1.0s under the old serial loop, and zero rate-limit
 * errors (63018 / HTTP 429) in recent traffic — so there is significant
 * headroom. 10 concurrent lifts throughput to roughly 10-15 msg/sec while
 * staying well inside typical Twilio WhatsApp limits.
 *
 * Tune with WHATSAPP_SEND_CONCURRENCY without a code change; sends that do hit
 * a limit are retried with backoff below rather than lost.
 */
const whatsAppSendConcurrency = (): number => {
  const raw = Number(process.env.WHATSAPP_SEND_CONCURRENCY);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 50) return raw;
  return 10;
};

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * Each worker is isolated: one recipient failing must never abort the rest of
 * the batch, so rejections are caught and logged here.
 */
const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await worker(item);
      } catch (err) {
        console.error("[Scheduler] recipient failed:", err);
      }
    }
  });
  await Promise.all(runners);
};

export const processPendingSchedules = async (
  options: SchedulerRunOptions = {},
): Promise<SchedulerRunSummary> => {
  const now = options.now || new Date();
  const requestedLimit = Number(options.limit || 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(500, Math.trunc(requestedLimit)))
    : 50;
  const summary: SchedulerRunSummary = {
    scanned: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    pendingRetried: 0,
  };

  console.log("[Scheduler] processPendingSchedules started", {
    now: now.toISOString(),
    limit,
  });

  // Fetch IDs only, then atomically claim each one by flipping pending -> processing.
  // This prevents concurrent lambda invocations from picking up the same schedule.
  const pendingIds = await MessageSchedule.find({
    status: "pending",
    scheduledDate: { $lte: now },
  })
    .limit(limit)
    .select("_id")
    .lean();

  summary.scanned = pendingIds.length;
  console.log(`[Scheduler] Found ${pendingIds.length} pending schedule(s)`);

  for (const { _id } of pendingIds) {
    // Atomic claim: only proceed if we win the race to flip status to "processing".
    const schedule = await MessageSchedule.findOneAndUpdate(
      { _id, status: "pending" },
      {
        $set: { status: "processing", lastAttemptAt: new Date() },
        $inc: { attempts: 1 },
      },
      { new: true },
    );
    if (!schedule) {
      console.log(
        `[Scheduler] Schedule ${_id} already claimed by another invocation, skipping`,
      );
      continue;
    }

    console.log(
      `[Scheduler] Processing schedule ${schedule._id} | channel=${schedule.channel} | template=${schedule.messageType}`,
    );
    summary.processed += 1;
    try {
      const event = await Event.findById(schedule.eventId);
      if (!event) {
        console.warn(
          `[Scheduler] Event not found for schedule ${schedule._id}`,
        );
        await MessageSchedule.findByIdAndUpdate(schedule._id, {
          status: "failed",
          errorMessage: "Event not found",
          lastAttemptAt: new Date(),
        });
        summary.failed += 1;
        continue;
      }

      const audienceFilter = resolveAudienceFilter(
        schedule.targetAudience,
        schedule.targetTag,
      );
      // Only filter by createdAt — not updatedAt — so guests who responded
      // after the schedule was created are still included.
      const rsvps = await RSVP.find({
        eventId: schedule.eventId,
        ...audienceFilter,
        createdAt: { $lte: schedule.scheduledDate },
      });
      console.log(
        `[Scheduler] Schedule ${schedule._id} | ${rsvps.length} recipient(s) matched`,
      );
      const baseUrl =
        process.env.RSVP_PUBLIC_BASE_URL || process.env.FRONTEND_URL || "";
      // siteBase is the root domain without any path suffix (e.g. https://www.softinvite.com)
      // Used for /rsvp/respond/:id links so we don't double-up the /rsvp prefix
      const siteBase = baseUrl
        ? baseUrl.replace(/\/$/, "").replace(/\/rsvp$/, "")
        : "";

      let sentCount = 0;
      // templateId may be a Mongo ObjectId string OR a Content Manager
      // friendlyName like "rsvp_stalo". Only findById when ObjectId-like.
      const isObjectIdLike = (v: any) =>
        typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
      const template =
        schedule.templateId &&
        schedule.channel === "email" &&
        isObjectIdLike(schedule.templateId)
          ? await EmailTemplate.findById(schedule.templateId as any)
          : null;
      const whatsappTemplate =
        schedule.templateId &&
        schedule.channel === "whatsapp" &&
        isObjectIdLike(schedule.templateId)
          ? await WhatsAppTemplate.findById(schedule.templateId as any)
          : null;

      // Pre-create RSVPFormLink for any schedule whose template has an
      // RSVP form link variable. Shared token across all guests in this run.
      // templateId may be ObjectId (legacy) OR a Content Manager friendlyName.
      const directTemplateName =
        !isObjectIdLike(schedule.templateId) &&
        typeof schedule.templateId === "string" &&
        schedule.templateId.trim().length > 0
          ? schedule.templateId.trim()
          : null;
      const schedulerTemplateName =
        whatsappTemplate?.name ||
        directTemplateName ||
        getDefaultWhatsAppTemplateName();

      // Load DB-stored Content template definition once per schedule (used
      // both to detect rsvp_form_path autoSource and to build params later).
      let scheduleDbDefinition: VariableDefinition[] | null = null;
      if (schedule.channel === "whatsapp") {
        try {
          const dbDoc = await (WhatsAppContentTemplate as any)
            .findOne({
              friendlyName: schedulerTemplateName,
              approvalStatus: "approved",
            })
            .select({ variableDefinitions: 1, headerMediaUrl: 1 })
            .lean();
          scheduleDbDefinition = Array.isArray(dbDoc?.variableDefinitions)
            ? dbDoc.variableDefinitions
            : null;
        } catch (e) {
          console.warn("[Scheduler] DB content template lookup failed", e);
        }
      }

      const dbHasRsvpFormPath = Array.isArray(scheduleDbDefinition)
        ? scheduleDbDefinition.some(
            (d: any) => d?.autoSource === "rsvp_form_path",
          )
        : false;

      const requiresRsvpFormLink =
        schedule.channel === "whatsapp" &&
        (/^rsvp_form/i.test(schedulerTemplateName) || dbHasRsvpFormPath);

      let rsvpFormPassUrl = "";
      if (requiresRsvpFormLink) {
        const fToken = generateRsvpToken(16);
        // Schedule-level URL wins, then the event-level default.
        const schedRedirectUrl = resolveExternalFormUrl(
          (schedule as any).redirectUrl,
          event as any,
        );
        try {
          const formLink = await RSVPFormLink.create({
            eventId: event._id,
            token: fToken,
            redirectUrl: schedRedirectUrl,
          });
          rsvpFormPassUrl = formLink.token;
          console.log(
            `[Scheduler] Created RSVPFormLink token=${rsvpFormPassUrl} for schedule=${schedule._id} (template=${schedulerTemplateName}, dbHasRsvpFormPath=${dbHasRsvpFormPath})`,
          );
        } catch (err) {
          console.error("[Scheduler] Failed to create RSVPFormLink", err);
          rsvpFormPassUrl = fToken;
        }
      }

      const replyTo = (event as any)?.channelConfig?.email?.replyTo;
      const scheduleInlineImage =
        schedule.channel === "email" ? scheduleInlineImageUrl(schedule) : "";
      const scheduleAttachment =
        schedule.channel === "email" && !scheduleInlineImage
          ? await resolveScheduleAttachment(schedule)
          : null;

      if (
        requiresExplicitScheduleBody(schedule) &&
        !hasExplicitScheduleBody(schedule)
      ) {
        console.warn(
          `[Scheduler] Schedule ${schedule._id} has empty message body, marking failed`,
        );
        await MessageSchedule.findByIdAndUpdate(schedule._id, {
          status: "failed",
          lastAttemptAt: new Date(),
          errorMessage: "Message body is empty; schedule not sent",
        });
        summary.failed += 1;
        continue;
      }
      // Recipients are dispatched with bounded concurrency rather than one
      // at a time. The serial loop plus a 250ms delay capped throughput at
      // roughly 1 message/second, so a large list finished minutes after it
      // started — the last guest on a 1000-person send waited ~20 minutes.
      // Email was unaffected because it has no such delay, which is why only
      // WhatsApp looked late.
      await runWithConcurrency(rsvps, whatsAppSendConcurrency(), async (rsvp) => {
        const email = rsvp.email || "";
        if (schedule.channel === "email" && !email) return;
        if (
          schedule.channel === "whatsapp" &&
          !String(rsvp.phone || "").trim()
        ) {
          return;
        }
        const channelAllowed = await canUseChannel(
          String(rsvp._id),
          schedule.channel,
          event,
        );
        if (!channelAllowed) return;

        if (schedule.channel === "email") {
          const html = await buildScheduleEmailHtml(
            event,
            rsvp,
            schedule,
            siteBase,
            template?.html || null,
            scheduleInlineImage,
          );
          const subject =
            schedule.messageTitle ||
            template?.subject ||
            `${schedule.messageName || schedule.messageType} - ${event.name}`;
          await sendEmail(
            email,
            subject,
            html,
            buildEventEmailFrom(event),
            scheduleAttachment ? [scheduleAttachment] : undefined,
            {
              eventId: String(event._id),
              rsvpId: String(rsvp._id),
              messageType: schedule.messageType,
              replyTo,
            },
          );
          sentCount += 1;
        } else if (schedule.channel === "whatsapp") {
          // Use the templateName already resolved at the schedule level so
          // Content Manager friendlyNames (e.g. "rsvp_stalo", "rsvp_form")
          // aren't lost to the env-var default.
          const templateName = schedulerTemplateName;
          const rsvpLink =
            rsvp?.token && siteBase
              ? `${siteBase}/rsvp/${rsvp.token}`
              : "";
          const scheduleHeaderMediaUrl = resolveWhatsAppHeaderMediaUrl(
            schedule?.attachment,
          );
          const bucket = String(process.env.S3_BUCKET || "").trim();
          const region = String(process.env.AWS_REGION || "").trim();
          const eventIdValue = String(event?._id || "").trim();
          const qrGuestId = String(
            (rsvp as any)?.guestId || rsvp?._id || "",
          ).trim();
          const qrPassUrl =
            bucket && region && eventIdValue && qrGuestId
              ? `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/email_png/${eventIdValue}/${qrGuestId}.png`
              : "";
          const passUrl =
            // Legacy hardcoded rsvp_form OR any DB template with an
            // rsvp_form_path autoSource: ship the pre-created token so the
            // RSVP link points at /r/{token} via either the hardcoded
            // wiring or the dynamic builder's `rsvp_form_path` resolver.
            /^rsvp_form/i.test(templateName) ||
            (dbHasRsvpFormPath && rsvpFormPassUrl)
              ? rsvpFormPassUrl || " "
              : /^rsvp_followup/i.test(templateName) ||
                  /^wedding_invite/i.test(templateName)
                ? qrPassUrl || rsvpLink || event?.iv || ""
                : rsvpLink || event?.iv || "";

          console.log(
            `[Scheduler] WhatsApp | schedule=${schedule._id} | template=${templateName} | guest=${rsvp._id} | phone=${rsvp.phone}`,
          );
          console.log(
            `[Scheduler] WhatsApp | passUrl=${passUrl} | event.iv=${event?.iv || "(none)"} | qrPassUrl=${qrPassUrl}`,
          );

          // Reuse the schedule-level DB definition (single lookup per
          // schedule, shared across guests). No per-guest DB hit.
          const dbCustomDefinition = scheduleDbDefinition;

          // For wedding_invite, mediaUrl is part of the body (variable 8), never pass it as a header.
          const templateParams = buildSchedulerWhatsAppTemplateParams({
            templateName,
            event,
            rsvp,
            passUrl,
            headerValue: scheduleHeaderMediaUrl || null,
            templateVariables: (schedule as any)?.templateVariables || null,
            customDefinition: dbCustomDefinition,
          });

          // null means a required auto-variable is missing (e.g. event.iv for wedding_invite)
          if (templateParams === null) {
            console.warn(
              `[Scheduler] Skipping WhatsApp send for rsvp ${rsvp._id} — templateParams is null (event.iv missing for wedding_invite)`,
            );
            return;
          }

          console.log(
            `[Scheduler] WhatsApp | contentVariables=${JSON.stringify(
              (templateParams as string[]).reduce(
                (acc: Record<string, string>, v, i) => {
                  acc[String(i + 1)] = v;
                  return acc;
                },
                {},
              ),
            )}`,
          );

          const waResult = await whatsappService.sendTemplateMessage(
            rsvp.phone || "",
            templateName,
            templateParams as string[],
            String(rsvp._id),
            String(event._id),
            {}, // no mediaUrl – wedding_invite image is inside body variable {{8}}
          );

          console.log(
            `[Scheduler] WhatsApp result | success=${waResult.success} | messageId=${waResult.messageId || ""} | error=${waResult.error || ""}`,
          );

          if (waResult.success) {
            sentCount += 1;
          }
        } else if (schedule.channel === "bulkSms") {
          const smsMessage = buildScheduleTextMessage(
            schedule,
            event,
            rsvp,
            template?.html || null,
          );
          const smsResult = await smsService.sendSms({
            to: rsvp.phone || "",
            message: smsMessage || `${event.name}: You're invited!`,
            eventId: String(event._id),
            rsvpId: String(rsvp._id),
          });
          if (smsResult.success) {
            sentCount += 1;
          } else {
            console.warn(
              `[Scheduler] SMS failed for rsvp ${rsvp._id}: ${smsResult.error}`,
            );
          }
        }
      });

      console.log(
        `[Scheduler] Schedule ${schedule._id} done | sentCount=${sentCount}`,
      );
      // attempts already incremented during atomic claim above
      await MessageSchedule.findByIdAndUpdate(schedule._id, {
        status: "sent",
        lastAttemptAt: new Date(),
        errorMessage: sentCount ? null : "No recipients sent",
      });
      summary.sent += 1;
    } catch (error: any) {
      console.error(
        `[Scheduler] Schedule ${schedule._id} threw an error:`,
        error?.message || error,
      );
      // attempts already incremented during atomic claim; only retry on first failure
      const shouldRetry = schedule.attempts <= 1;
      await MessageSchedule.findByIdAndUpdate(schedule._id, {
        status: shouldRetry ? "pending" : "failed",
        lastAttemptAt: new Date(),
        errorMessage: error?.message || "Failed to process schedule",
      });
      if (shouldRetry) {
        summary.pendingRetried += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  console.log("[Scheduler] processPendingSchedules complete", summary);
  return summary;
};
