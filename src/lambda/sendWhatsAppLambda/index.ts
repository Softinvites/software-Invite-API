import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { WhatsAppMessage } from "./whatsappmessagemodel.js";
import { WhatsAppTemplate } from "./whatsapptemplatemodel.js";
import { WhatsAppContentTemplate } from "./whatsappcontenttemplatemodel.js";
import { RSVPFormLink } from "./rsvpFormLinkModel.js";
import {
  resolveExternalFormUrl,
  applyHeaderMediaDefaults,
} from "./dynamicTemplateBuilder.js";
import { invokeLambda } from "./lambdaUtils.js";
import {
  buildDynamicTemplateParams,
  VariableDefinition,
} from "./dynamicTemplateBuilder.js";
import axios from "axios";
import crypto from "crypto";
import twilio from "twilio";

const generateRsvpToken = (bytes = 16) =>
  crypto.randomBytes(bytes).toString("base64url");

const HARDCODED_LAMBDA_TEMPLATE_PATTERNS = [
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

const isHardcodedLambdaTemplate = (templateName: string) =>
  HARDCODED_LAMBDA_TEMPLATE_PATTERNS.some((rx) =>
    rx.test(templateName || ""),
  );

const { ADMIN_EMAIL, EMAIL_LAMBDA_FUNCTION_NAME } = process.env;
let cachedPhoneNumberId: string | null =
  process.env.WHATSAPP_PHONE_NUMBER_ID || null;
const provider = (
  process.env.WHATSAPP_PROVIDER ||
  (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "meta")
).toLowerCase();

interface TwilioTemplateConfig {
  contentSid: string | null;
  statusCallbackUrl: string | null;
}

interface WhatsAppResult {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  details: Array<{
    guestId: string;
    name: string;
    messageId?: string;
    error?: string;
    status: string;
  }>;
}

const looksLikeTwilioContentSid = (value: string) =>
  /^HX[0-9a-fA-F]{32}$/.test(String(value || "").trim());

const sanitizeTwilioContentVariableValue = (value: unknown): string => {
  const normalized = String(value ?? "")
    .replace(/[\r\n\t]/g, " ") // remove newlines and tabs
    .replace(/ {5,}/g, "    ") // collapse 5+ spaces to 4
    .replace(/[\u2018\u2019]/g, "'") // curly apostrophes to straight
    .replace(/[\u201C\u201D]/g, '"') // curly quotes to straight
    .replace(/[\u2013\u2014]/g, "-") // em/en dash to hyphen
    .trim();
  return normalized || "-";
};

const buildTwilioContentVariables = (templateParams: string[]): string => {
  const variables: Record<string, string> = {};
  templateParams.forEach((param, index) => {
    variables[String(index + 1)] = sanitizeTwilioContentVariableValue(param);
  });
  return JSON.stringify(variables);
};

const getDefaultWhatsAppTemplateName = () =>
  provider === "twilio"
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
    : "event_invitation";

const hasExplicitTime = (value: string) =>
  /\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i.test(value);

const isEventPassLegacyModeEnabled = () =>
  String(process.env.TWILIO_EVENT_PASS_LEGACY_MODE || "").toLowerCase() ===
  "true";

const getPassUrlVariableIndex = () => {
  const rawValue = process.env.TWILIO_WHATSAPP_PASS_URL_VAR_INDEX;
  if (!rawValue) return 8;

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
};

const getHeaderMediaVarIndexEnvKey = (templateName: string) =>
  `TWILIO_WHATSAPP_HEADER_MEDIA_VAR_INDEX_${String(templateName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;

const getHeaderMediaVariableIndex = (templateName?: string) => {
  const templateOverrideKey = templateName
    ? getHeaderMediaVarIndexEnvKey(templateName)
    : "";
  const rawValue =
    (templateOverrideKey ? process.env[templateOverrideKey] : undefined) ||
    process.env.TWILIO_WHATSAPP_HEADER_MEDIA_VAR_INDEX;

  if (!rawValue) return 0;

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

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

  if (
    normalizedTemplate === "rsvp_party" ||
    normalizedTemplate === "rsvp_wedding"
  ) {
    return "full_url";
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

  if (!rawValue) {
    return { dateLabel: "TBA", timeLabel: fallbackTime };
  }

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

const buildTemplateParams = ({
  templateName,
  recipientName,
  eventName,
  location,
  tableNo,
  eventDate,
  passUrl,
  eventIv,
  headerValue,
  templateVariables,
  customDefinition,
}: {
  templateName: string;
  recipientName: string;
  eventName: string;
  location?: string | null;
  tableNo?: string | null;
  eventDate?: string | null;
  passUrl?: string | null;
  eventIv?: string | null;
  headerValue?: string | null;
  templateVariables?: WhatsAppTemplateVariableOverrides | null;
  customDefinition?: VariableDefinition[] | null;
}) => {
  const { dateLabel, timeLabel } = formatWhatsAppEventDateTime(eventDate);

  // Data-driven path: if a DB-stored template definition was loaded (an
  // APPROVED Manager template exists for this name), build params from the
  // metadata. This overrides hardcoded templates of the same name. When no
  // definition is supplied, the hardcoded branches below run as before.
  if (Array.isArray(customDefinition) && customDefinition.length > 0) {
    return buildDynamicTemplateParams(
      customDefinition,
      {
        recipientName: recipientName || "Guest",
        eventName: eventName || "Our Event",
        location: location || "TBA",
        tableNo: tableNo || null,
        dateLabel,
        timeLabel,
        signoff: eventName || "SoftInvites",
        eventIv: eventIv || null,
        passUrl: passUrl || null,
      },
      templateVariables || null,
    );
  }

  if (/^event_invitation/i.test(templateName)) {
    const params = [
      recipientName || "Guest",
      eventName || "Our Event",
      location || "TBA",
      dateLabel,
      timeLabel,
      eventIv || "",
    ];
    return applyTemplateVariableOverrides(params, templateVariables);
  }

  if (/^event_details_reminder/i.test(templateName)) {
    const params = [
      recipientName || "Guest",
      eventName || "Our Event",
      location || "TBA",
      dateLabel,
      timeLabel,
    ];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["1"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^event_reminder/i.test(templateName)) {
    const params = [
      recipientName || "Guest",
      eventName || "Our Event",
      location || "TBA",
      dateLabel,
      timeLabel,
    ];
    return applyTemplateVariableOverrides(params, templateVariables);
  }

  if (/^rsvp_party/i.test(templateName)) {
    const rsvpId = normalizePassUrlVariableValue(passUrl || "", templateName);
    const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
    const params = [
      eventName || "Our Event",
      recipientName || "Guest",
      eventName || "Our Event",
      eventName || "Our Event",
      dateLabel,
      timeLabel,
      headerMediaKey || " ",
      rsvpId ? `${rsvpId}?status=yes` : " ",
      rsvpId ? `${rsvpId}?status=no` : " ",
    ];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["2"];
    delete filtered["7"];
    delete filtered["8"];
    delete filtered["9"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^rsvp_wedding/i.test(templateName)) {
    const rsvpId = normalizePassUrlVariableValue(passUrl || "", templateName);
    const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
    const params = [
      eventName || "Our Event",
      recipientName || "Guest",
      eventName || "Our Family",
      eventName || "Our Event",
      eventName || "the couple",
      dateLabel,
      timeLabel,
      location || "TBA",
      headerMediaKey || " ",
      rsvpId ? `${rsvpId}?status=yes` : " ",
      rsvpId ? `${rsvpId}?status=no` : " ",
    ];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["2"];
    delete filtered["9"];
    delete filtered["10"];
    delete filtered["11"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^rsvp_form/i.test(templateName)) {
    const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
    const formPath = passUrl || " ";
    const params = [
      eventName || "Our Event",    // {{1}} frontend editable
      recipientName || "Guest",    // {{2}} AUTO: guest name (locked)
      eventName || "Our Event",    // {{3}} frontend editable
      dateLabel,                   // {{4}} AUTO: date
      timeLabel,                   // {{5}} AUTO: time
      location || "TBA",           // {{6}} frontend editable
      headerMediaKey || " ",       // {{7}} AUTO: S3 image key (locked)
      formPath,                    // {{8}} AUTO: RSVP form link path (locked)
    ];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["2"];
    delete filtered["7"];
    delete filtered["8"];
    if (filtered["1"] && !filtered["3"]) filtered["3"] = filtered["1"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^rsvp_followup/i.test(templateName)) {
    const params = [
      recipientName || "Guest",
      eventName || "Our Event",
      location || "TBA",
      dateLabel,
      timeLabel,
      normalizePassUrlVariableValue(passUrl || "", templateName),
    ];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["1"];
    delete filtered["6"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^logistics/i.test(templateName)) {
    const params = [recipientName || "Guest", eventName || "Our Event"];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["1"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^wedding_invite/i.test(templateName)) {
    // {{10}} = S3 path of event invitation image (header media)
    const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
    // {{11}} = suffix after "qr_codes/email_png/" for the View Digital Pass button
    const passSuffix = normalizePassUrlVariableValue(
      passUrl || "",
      templateName,
    );

    if (!headerMediaKey) {
      console.error(
        "[sendWhatsAppLambda] wedding_invite requires event.iv (S3 image URL). " +
          "Upload an invitation image when creating/updating the event.",
      );
      return [];
    }

    console.log("[sendWhatsAppLambda] wedding_invite params", {
      recipientName,
      eventIv: eventIv || "(none)",
      headerMediaKey,
      passUrl: passUrl || "(none)",
      passSuffix,
    });

    // 11 variables – Twilio requires all to be non-empty strings
    const params = Array.from({ length: 11 }, () => "");
    params[0] = eventName || "Our Event"; // {{1}}  event title
    params[1] = recipientName || "Guest"; // {{2}}  guest name (AUTO – locked)
    params[2] = templateVariables?.["3"] || eventName || "Our Family"; // {{3}}  host/family name
    params[3] = templateVariables?.["4"] || eventName || "Our Event"; // {{4}}  ceremony type
    params[4] = templateVariables?.["5"] || eventName || "the couple"; // {{5}}  couple names
    params[5] = templateVariables?.["6"] || "Ceremony"; // {{6}}  ceremony label
    params[6] = templateVariables?.["7"] || dateLabel || "TBA"; // {{7}}  date (frontend editable)
    params[7] = templateVariables?.["8"] || timeLabel || "TBA"; // {{8}}  time (frontend editable)
    params[8] = templateVariables?.["9"] || location || "TBA"; // {{9}}  venue (frontend editable)
    params[9] = headerMediaKey || "WhatsApp+Image+2026-04-21+at+08.19.49.jpeg"; // {{10}} S3 image path (AUTO – locked)
    params[10] = passSuffix || "missing.png"; // {{11}} pass URL suffix (AUTO – locked)

    // Lock only AUTO variables: 2 (guest name), 10 (image), 11 (pass)
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["2"];
    delete filtered["10"];
    delete filtered["11"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^event_pass/i.test(templateName)) {
    if (isEventPassLegacyModeEnabled()) {
      const params = [
        recipientName || "Guest",
        eventName || "Our Event",
        location || "TBA",
        dateLabel,
        timeLabel,
        "SoftInvites",
      ];

      const passUrlVariableIndex = getPassUrlVariableIndex();
      if (
        passUrlVariableIndex &&
        passUrlVariableIndex > params.length &&
        passUrl
      ) {
        params[passUrlVariableIndex - 1] = normalizePassUrlVariableValue(
          passUrl,
          templateName,
        );
      }
      return applyTemplateVariableOverrides(params, templateVariables);
    }

    const passUrlVariableIndex = getPassUrlVariableIndex() || 8;
    const minLength = Math.max(8, passUrlVariableIndex);
    const params = Array.from({ length: minLength }, () => "");

    params[0] = resolveEventPassHeaderValue({
      templateName,
      headerValue,
      eventName,
      eventIv,
      passUrl,
    });
    params[1] = recipientName || "Guest";
    params[2] = eventName || "Our Event";
    params[3] = location || "TBA";
    params[4] = dateLabel;
    params[5] = timeLabel;
    params[6] = "SoftInvites";
    if (passUrl) {
      params[passUrlVariableIndex - 1] = normalizePassUrlVariableValue(
        passUrl,
        templateName,
      );
    }
    return applyTemplateVariableOverrides(params, templateVariables);
  }

  const fallback = [
    recipientName || "Guest",
    eventName || "Our Event",
    location || "TBA",
    eventDate || "TBA",
    passUrl || "",
  ];
  return applyTemplateVariableOverrides(fallback, templateVariables);
};

async function resolveTwilioTemplateConfig(
  templateName: string,
  eventId: string,
): Promise<TwilioTemplateConfig> {
  if (looksLikeTwilioContentSid(templateName)) {
    return {
      contentSid: templateName,
      statusCallbackUrl:
        process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL || null,
    };
  }

  const envKey = `TWILIO_CONTENT_SID_${templateName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;
  const envContentSid = process.env[envKey];

  const templateDoc = (await WhatsAppTemplate.findOne({
    eventId,
    $or: [{ name: templateName }, { displayName: templateName }],
    isActive: true,
  })
    .select({ contentSid: 1, statusCallbackUrl: 1 })
    .lean()) as {
    contentSid?: string | null;
    statusCallbackUrl?: string | null;
  } | null;

  // DB-stored Content Template Manager templates (global, approved). An
  // approved Manager template is authoritative — its contentSid takes
  // priority over the env-var hardcoded SID, so re-creating a template like
  // rsvp_followup in the Manager swaps it in without code changes.
  let dbContentSid: string | null = null;
  try {
    const dbDoc = (await WhatsAppContentTemplate.findOne({
      friendlyName: templateName,
      approvalStatus: "approved",
    })
      .select({ contentSid: 1 })
      .lean()) as { contentSid?: string | null } | null;
    dbContentSid = dbDoc?.contentSid || null;
  } catch (err) {
    console.warn(
      "[sendWhatsAppLambda] DB content template lookup failed:",
      err,
    );
  }

  return {
    // Priority: approved Manager template > per-event template > env-var SID.
    contentSid:
      dbContentSid || templateDoc?.contentSid || envContentSid || null,
    statusCallbackUrl:
      templateDoc?.statusCallbackUrl ||
      process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL ||
      null,
  };
}

export const handler = async (event: any) => {
  try {
    console.log("📱 WhatsApp Bulk Send Started");

    const {
      eventId,
      templateName = getDefaultWhatsAppTemplateName(),
      guestIds,
      templateVariables,
      formLinkPath,
    } = event;
    if (!eventId) {
      return { statusCode: 400, body: "Missing eventId" };
    }

    await connectDB();

    const eventDoc = await Event.findById(eventId);
    if (!eventDoc) {
      return { statusCode: 404, body: "Event not found" };
    }

    let guestQuery: any = { eventId, phone: { $exists: true, $ne: "" } };
    if (guestIds && guestIds.length > 0) {
      guestQuery._id = { $in: guestIds };
    }

    const guests = await Guest.find(guestQuery).sort({ createdAt: -1 });
    if (!guests.length) {
      return { statusCode: 404, body: "No guests with phone numbers found" };
    }

    console.log(`📱 Found ${guests.length} guests with phone numbers`);

    let phoneNumberId: string | undefined;
    if (provider !== "twilio") {
      try {
        phoneNumberId = await resolvePhoneNumberId();
      } catch (resolveErr: any) {
        console.error(
          "Failed to resolve WhatsApp phone number id before sending:",
          resolveErr.response?.data || resolveErr.message || resolveErr,
        );
        return {
          statusCode: 500,
          body: JSON.stringify({
            message:
              "Unable to resolve WhatsApp phone number ID; check access token, business account ID, and phone number setup.",
            error:
              resolveErr.response?.data ||
              resolveErr.message ||
              String(resolveErr),
          }),
        };
      }
    }

    const results: WhatsAppResult = {
      total: guests.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    const failed: any[] = [];
    // Only a repeated guest name counts as a duplicate. Couples and families
    // often share one WhatsApp number and email, and each guest still needs
    // their own invitation and pass.
    const seenNameKeys = new Set<string>();

    // Pre-compute shared values once for all guests to avoid repeated computation
    // and ensure consistency across the entire batch
    const precomputedContentSid =
      provider === "twilio"
        ? await resolveTwilioTemplateConfig(templateName, eventId)
            .then((c) => c.contentSid)
            .catch(() => null)
        : null;
    const precomputedIvKey = /^wedding_invite/i.test(templateName)
      ? normalizeHeaderMediaVariableValue(eventDoc.iv || "")
      : null;

    // Load DB-stored content template definition once. Attempted for ALL
    // template names — an approved Manager template overrides the hardcoded
    // one of the same name. If none is found, precomputedDbDefinition stays
    // null and the hardcoded builder path runs (unchanged behavior).
    let precomputedDbDefinition: VariableDefinition[] | null = null;
    {
      try {
        const dbDoc = (await WhatsAppContentTemplate.findOne({
          friendlyName: templateName,
          approvalStatus: "approved",
        })
          .select({ variableDefinitions: 1, headerMediaUrl: 1 })
          .lean()) as { variableDefinitions?: VariableDefinition[] } | null;
        precomputedDbDefinition = Array.isArray(dbDoc?.variableDefinitions)
          ? dbDoc!.variableDefinitions!
          : null;
        if (precomputedDbDefinition) {
          console.log(
            `[sendWhatsAppLambda] Using approved Manager template "${templateName}" (${precomputedDbDefinition.length} vars).`,
          );
        } else if (!isHardcodedLambdaTemplate(templateName)) {
          console.warn(
            `[sendWhatsAppLambda] No approved DB content template found for "${templateName}". Send may fail.`,
          );
        }
      } catch (err) {
        console.warn(
          "[sendWhatsAppLambda] DB content template lookup failed:",
          err,
        );
      }
    }

    // RSVP form-link pre-create: legacy `rsvp_form` OR any DB template that
    // has a variable with autoSource `rsvp_form_path`. Shared token across
    // the entire batch so a single click handles them all server-side.
    const dbHasRsvpFormPath = Array.isArray(precomputedDbDefinition)
      ? precomputedDbDefinition.some(
          (d: any) => d?.autoSource === "rsvp_form_path",
        )
      : false;

    const dbNeedsQrPass = Array.isArray(precomputedDbDefinition)
      ? precomputedDbDefinition.some(
          (d: any) =>
            d?.autoSource === "qr_pass_url" || d?.autoSource === "qr_pass_suffix",
        )
      : false;
    const needsQrPass =
      /^rsvp_followup/i.test(templateName) ||
      /^wedding_invite/i.test(templateName) ||
      /^event_pass/i.test(templateName) ||
      dbNeedsQrPass;

    const needsRsvpFormLink =
      /^rsvp_form/i.test(templateName) || dbHasRsvpFormPath;

    // Bulk sends used to hardcode redirectUrl: null, silently dropping an
    // event's external RSVP form and landing every guest on our own form.
    const bulkRedirectUrl = resolveExternalFormUrl(
      (event as any)?.redirectUrl,
      eventDoc as any,
    );

    let precomputedFormLinkPath: string | null = formLinkPath || null;
    if (needsRsvpFormLink && !precomputedFormLinkPath) {
      const fToken = generateRsvpToken(16);
      try {
        const link = await RSVPFormLink.create({
          eventId: eventDoc._id,
          token: fToken,
          redirectUrl: bulkRedirectUrl,
        });
        precomputedFormLinkPath = link.token;
        console.log(
          `[sendWhatsAppLambda] Created RSVPFormLink token=${precomputedFormLinkPath} (template=${templateName}, dbHasRsvpFormPath=${dbHasRsvpFormPath})`,
        );
      } catch (err) {
        console.error(
          "[sendWhatsAppLambda] Failed to create RSVPFormLink",
          err,
        );
        precomputedFormLinkPath = fToken;
      }
    }

    if (/^wedding_invite/i.test(templateName) && !precomputedIvKey) {
      console.error(
        "[sendWhatsAppLambda] wedding_invite requires event.iv. Aborting.",
      );
      return {
        statusCode: 400,
        body: JSON.stringify({
          message:
            "wedding_invite requires an invitation image (event.iv). Upload an image when creating/updating the event.",
        }),
      };
    }

    const BATCH_SIZE = 10;
    const DELAY_MS = 250;
    for (let i = 0; i < guests.length; i += BATCH_SIZE) {
      const batch = guests.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (guest) => {
          try {
            // Normalize phone: strip all spaces and non-digit chars except leading +
            const normalizedPhone = guest.phone
              ? guest.phone.replace(/\s+/g, "").replace(/[^\d+]/g, "")
              : "";

            if (!normalizedPhone) {
              results.failed++;
              const failedGuest = {
                fullname: guest.fullname,
                phone: guest.phone,
                error: "No phone number",
              };
              failed.push(failedGuest);
              results.details.push({
                guestId: guest._id.toString(),
                name: guest.fullname,
                error: "No phone number",
                status: "failed",
              });
              return;
            }

            const nameKey = String(guest.fullname || "")
              .trim()
              .replace(/\s+/g, " ")
              .toLowerCase();
            if (nameKey) {
              if (seenNameKeys.has(nameKey)) {
                results.skipped++;
                results.details.push({
                  guestId: guest._id.toString(),
                  name: guest.fullname,
                  error: "Duplicate name - skipped",
                  status: "skipped",
                });
                return;
              }
              seenNameKeys.add(nameKey);
            }

            const normalizedTemplate = String(templateName || "")
              .toLowerCase()
              .trim();
            const bucket = String(process.env.S3_BUCKET || "").trim();
            const region = String(process.env.AWS_REGION || "").trim();
            const eventIdValue = String(
              (eventDoc as any)?._id || eventId || "",
            ).trim();
            const qrFromS3 =
              bucket && region && eventIdValue
                ? `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/email_png/${eventIdValue}/${guest._id.toString()}.png`
                : "";
            const fallbackUrl = (guest as any).pngUrl ||
              (guest.qrCode?.includes(".png")
                ? guest.qrCode
                : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`);
            const qrCodeUrl =
              // Legacy rsvp_form OR any DB template whose definition has
              // an `rsvp_form_path` autoSource: use the pre-created shared
              // form link token. Same plumbing as rsvp_form, just generalized.
              normalizedTemplate === "rsvp_form" ||
              (dbHasRsvpFormPath && precomputedFormLinkPath)
                ? precomputedFormLinkPath || " "
                : needsQrPass
                  ? qrFromS3 || fallbackUrl
                  : normalizedTemplate === "rsvp_party" ||
                      normalizedTemplate === "rsvp_wedding"
                    ? guest._id.toString()
                    : fallbackUrl;

            const templateParams = buildTemplateParams({
              templateName,
              recipientName: guest.fullname,
              eventName: eventDoc.name,
              location: eventDoc.location || "TBA",
              tableNo: (guest as any).TableNo || null,
              eventDate: eventDoc.date || "TBA",
              passUrl: qrCodeUrl,
              eventIv: eventDoc.iv || null,
              templateVariables: templateVariables || null,
              customDefinition: precomputedDbDefinition,
            });

            // Empty params means a required auto-variable (e.g. event.iv for wedding_invite) is missing
            if (templateParams.length === 0) {
              results.failed++;
              const failedGuest = {
                fullname: guest.fullname,
                phone: guest.phone,
                error:
                  "wedding_invite requires an invitation image (event.iv). Upload an image when creating/updating the event.",
              };
              failed.push(failedGuest);
              results.details.push({
                guestId: guest._id.toString(),
                name: guest.fullname,
                error: failedGuest.error,
                status: "failed",
              });
              return;
            }

            // For wedding_invite, mediaUrl is now part of the body (variable 8), so we pass null.
            const result = await sendWhatsAppMessage(
              normalizedPhone,
              templateName,
              templateParams,
              guest._id.toString(),
              (eventDoc._id as any).toString(),
              phoneNumberId,
              true,
              null,
              precomputedContentSid,
            );

            if (result.success) {
              results.sent++;
              results.details.push({
                guestId: guest._id.toString(),
                name: guest.fullname,
                messageId: result.messageId,
                status: "sent",
              });
            } else {
              results.failed++;
              const failedGuest = {
                fullname: guest.fullname,
                phone: normalizedPhone,
                error: result.error || "Unknown error",
              };
              failed.push(failedGuest);
              results.details.push({
                guestId: guest._id.toString(),
                name: guest.fullname,
                error: result.error,
                status: "failed",
              });
            }

            await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
          } catch (error: any) {
            results.failed++;
            const failedGuest = {
              fullname: guest.fullname,
              phone: guest.phone,
              error: error.message || String(error),
            };
            failed.push(failedGuest);
            results.details.push({
              guestId: guest._id.toString(),
              name: guest.fullname,
              error: error.message,
              status: "failed",
            });
          }
        }),
      );

      console.log(`WhatsApp batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
    }

    try {
      await invokeLambda(EMAIL_LAMBDA_FUNCTION_NAME!, {
        to: ADMIN_EMAIL,
        from: `SoftInvites <info@softinvite.com>`,
        subject: `WhatsApp Send Complete - ${eventDoc.name}`,
        htmlContent: buildAdminEmailTemplate(eventDoc, results, failed),
        eventId: event.eventId,
        messageType: "whatsapp-admin-summary",
        diagnosticContext: {
          source: "sendWhatsAppLambda",
          trigger: "whatsapp-summary",
        },
      });
    } catch (adminEmailError) {
      console.error("Failed to send admin notification:", adminEmailError);
    }

    console.log("✅ WhatsApp Bulk Send Completed");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "WhatsApp bulk send completed",
        totalGuests: results.total,
        successCount: results.sent,
        failureCount: results.failed,
        skippedCount: results.skipped,
      }),
    };
  } catch (err: any) {
    console.error("❌ WhatsApp Bulk Send Failed:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "WhatsApp bulk send failed",
        error: err.message,
      }),
    };
  }
};

async function resolvePhoneNumberId(): Promise<string> {
  if (cachedPhoneNumberId) {
    return cachedPhoneNumberId;
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  if (!accessToken) {
    throw new Error(
      "Missing WHATSAPP_ACCESS_TOKEN for WhatsApp Cloud API calls",
    );
  }

  if (!businessAccountId) {
    throw new Error(
      "Missing WHATSAPP_BUSINESS_ACCOUNT_ID to resolve phone number ID",
    );
  }

  const url = `https://graph.facebook.com/v18.0/${businessAccountId}/phone_numbers`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      fields: "id,verified_name,display_phone_number,name_status",
    },
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    console.error(
      "Failed to list WhatsApp phone numbers from business account",
      {
        status: response.status,
        data: response.data,
      },
    );
    throw new Error(
      `Failed to list WhatsApp phone numbers (status ${response.status})`,
    );
  }

  const phoneNumberId = response.data?.data?.[0]?.id;
  if (!phoneNumberId) {
    throw new Error(
      "Unable to resolve WhatsApp phone number ID from business account",
    );
  }

  cachedPhoneNumberId = phoneNumberId;
  console.log(`ℹ️ Resolved WhatsApp phone number id ${phoneNumberId}`);
  return phoneNumberId;
}

async function sendWhatsAppMessage(
  phoneNumber: string,
  templateName: string,
  templateParams: string[],
  guestId: string,
  eventId: string,
  phoneNumberId?: string,
  allowRetry: boolean = true,
  mediaUrl?: string | null,
  precomputedContentSid?: string | null,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    let providerMessageId = "";

    if (provider === "twilio") {
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        throw new Error("Twilio credentials not configured");
      }

      const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      );
      const from = process.env.TWILIO_WHATSAPP_FROM;
      if (!from) {
        throw new Error("TWILIO_WHATSAPP_FROM not configured");
      }

      const to = phoneNumber.startsWith("whatsapp:")
        ? phoneNumber
        : `whatsapp:${phoneNumber}`;
      // Use pre-computed contentSid if available to avoid 128 repeated DB/env lookups
      const resolvedConfig = precomputedContentSid
        ? {
            contentSid: precomputedContentSid,
            statusCallbackUrl:
              process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL || null,
          }
        : await resolveTwilioTemplateConfig(templateName, eventId);
      const { contentSid, statusCallbackUrl } = resolvedConfig;
      const messagePayload: Record<string, unknown> = {
        from,
        to,
        ...(statusCallbackUrl ? { statusCallback: statusCallbackUrl } : {}),
      };

      if (contentSid) {
        const contentVariablesJson = buildTwilioContentVariables(
          templateParams || [],
        );
        console.log("[sendWhatsAppLambda/Twilio] Sending", {
          templateName,
          contentSid,
          paramCount: templateParams.length,
          contentVariables: contentVariablesJson,
          to,
        });
        messagePayload.contentSid = contentSid;
        messagePayload.contentVariables = contentVariablesJson;
      } else {
        messagePayload.body = templateParams?.length
          ? `${templateName}: ${templateParams.join(" | ")}`
          : `${templateName}`;
      }

      const response = await client.messages.create(messagePayload as any);
      console.log("[sendWhatsAppLambda/Twilio] Success", {
        sid: response.sid,
        templateName,
      });
      providerMessageId = response.sid;
    } else {
      const resolvedPhoneNumberId =
        phoneNumberId || (await resolvePhoneNumberId());
      const components: any[] = [
        {
          type: "body",
          parameters: templateParams.map((param) => ({
            type: "text",
            text: param,
          })),
        },
      ];

      const resolvedMedia = String(mediaUrl || "").trim();

      if (resolvedMedia) {
        components.unshift({
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: resolvedMedia },
            },
          ],
        });
      }

      const payload = {
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components,
        },
      };

      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${resolvedPhoneNumberId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      providerMessageId = response.data.messages[0].id;
    }

    const messageRecord = new WhatsAppMessage({
      guestId,
      eventId,
      templateName,
      providerMessageId,
      phoneNumber,
      status: "sent",
    });

    await messageRecord.save();

    return {
      success: true,
      messageId: providerMessageId,
    };
  } catch (error: any) {
    const graphError = error.response?.data?.error;
    const errorMessage = graphError?.message || error.message;

    if (
      provider !== "twilio" &&
      allowRetry &&
      graphError?.code === 100 &&
      graphError?.error_subcode === 33
    ) {
      console.warn(
        "WhatsApp phone number id rejected; attempting to resolve a valid id from the business account",
      );
      cachedPhoneNumberId = null;
      try {
        const newPhoneId = await resolvePhoneNumberId();
        return await sendWhatsAppMessage(
          phoneNumber,
          templateName,
          templateParams,
          guestId,
          eventId,
          newPhoneId,
          false,
          mediaUrl,
          precomputedContentSid,
        );
      } catch (resolveError: any) {
        console.error(
          "Failed to resolve WhatsApp phone number id after Graph error:",
          resolveError.message || resolveError,
        );
      }
    }

    console.error(
      "[sendWhatsAppLambda] WhatsApp send error:",
      error.response?.data || error.message,
    );

    const messageRecord = new WhatsAppMessage({
      guestId,
      eventId,
      templateName,
      providerMessageId: `failed_${Date.now()}`,
      phoneNumber,
      status: "failed",
      errorMessage: errorMessage,
    });

    await messageRecord.save();

    return {
      success: false,
      error: errorMessage,
    };
  }
}

function buildAdminEmailTemplate(
  eventDoc: any,
  results: WhatsAppResult,
  failed: any[],
): string {
  return `
    <div style="font-family: Arial, sans-serif; padding: 20px; background: #f7f8fc;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        <h2 style="color: #2d3748; border-bottom: 3px solid #25D366; padding-bottom: 10px;">
          📱 WhatsApp Send Completed Successfully
        </h2>
        
        <div style="background: #f8faff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #4a5568; margin-top: 0;">Event Details</h3>
          <p><strong>Event Name:</strong> ${eventDoc.name}</p>
          <p><strong>Event Date:</strong> ${eventDoc.date}</p>
          <p><strong>Processed At:</strong> ${new Date().toLocaleString()}</p>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
          <div style="background: #25D366; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Total Guests</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${results.total}</p>
          </div>
          
          <div style="background: #4299e1; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Sent Successfully</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${results.sent}</p>
          </div>
          
          <div style="background: #e53e3e; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Failed</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${results.failed}</p>
          </div>

          <div style="background: #718096; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Skipped (Duplicates)</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${results.skipped || 0}</p>
          </div>
          
          <div style="background: #805ad5; color: white; padding: 15px; border-radius: 8px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; font-size: 14px;">Success Rate</h3>
            <p style="font-size: 32px; font-weight: bold; margin: 0;">${Math.round((results.sent / Math.max(1, results.total - (results.skipped || 0))) * 100)}%</p>
          </div>
        </div>
        
        ${
          results.failed > 0
            ? `
          <div style="margin-bottom: 20px;">
            <h3 style="color: #e53e3e; margin-bottom: 15px;">❌ Failed Messages (${results.failed})</h3>
            <div style="max-height: 300px; overflow-y: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead style="background: #f7f8fc; position: sticky; top: 0;">
                  <tr>
                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Full Name</th>
                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Phone</th>
                    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e2e8f0;">Error</th>
                  </tr>
                </thead>
                <tbody>
                  ${failed
                    .slice(0, 50)
                    .map(
                      (guest) => `
                    <tr>
                      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.fullname || "N/A"}</td>
                      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${guest.phone || "N/A"}</td>
                      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #e53e3e;">${guest.error || "Unknown error"}</td>
                    </tr>
                  `,
                    )
                    .join("")}
                  ${
                    failed.length > 50
                      ? `
                    <tr>
                      <td colspan="3" style="padding: 8px; text-align: center; color: #718096;">
                        ... and ${failed.length - 50} more failed records
                      </td>
                    </tr>
                  `
                      : ""
                  }
                </tbody>
              </table>
            </div>
          </div>
        `
            : ""
        }
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #718096; font-size: 12px;">
          <p>WhatsApp send completed by Soft Invites System</p>
        </div>
      </div>
    </div>
  `;
}
