// const getConfiguredWhatsAppProvider = () =>
//   (
//     process.env.WHATSAPP_PROVIDER ||
//     (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "meta")
//   ).toLowerCase();

// const isEventPassLegacyModeEnabled = () =>
//   String(process.env.TWILIO_EVENT_PASS_LEGACY_MODE || "").toLowerCase() ===
//   "true";

// const hasExplicitTime = (value: string) =>
//   /\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i.test(value);

// const getPassUrlVarIndexEnvKey = (templateName: string) =>
//   `TWILIO_WHATSAPP_PASS_URL_VAR_INDEX_${String(templateName || "")
//     .toUpperCase()
//     .replace(/[^A-Z0-9]+/g, "_")}`;

// const getHeaderMediaVarIndexEnvKey = (templateName: string) =>
//   `TWILIO_WHATSAPP_HEADER_MEDIA_VAR_INDEX_${String(templateName || "")
//     .toUpperCase()
//     .replace(/[^A-Z0-9]+/g, "_")}`;

// const getPassUrlVariableIndex = (templateName?: string) => {
//   const templateOverrideKey = templateName
//     ? getPassUrlVarIndexEnvKey(templateName)
//     : "";
//   const rawValue =
//     (templateOverrideKey ? process.env[templateOverrideKey] : undefined) ||
//     process.env.TWILIO_WHATSAPP_PASS_URL_VAR_INDEX;
//   if (!rawValue) {
//     // Defaults based on templates we ship today.
//     const normalizedTemplate = String(templateName || "")
//       .toLowerCase()
//       .trim();
//     if (normalizedTemplate === "rsvp_followup") return 6;
//     return 8;
//   }

//   const parsed = Number.parseInt(rawValue, 10);
//   return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
// };

// const getHeaderMediaVariableIndex = (templateName?: string) => {
//   const templateOverrideKey = templateName
//     ? getHeaderMediaVarIndexEnvKey(templateName)
//     : "";
//   const rawValue =
//     (templateOverrideKey ? process.env[templateOverrideKey] : undefined) ||
//     process.env.TWILIO_WHATSAPP_HEADER_MEDIA_VAR_INDEX;

//   if (!rawValue) return 0;

//   const parsed = Number.parseInt(rawValue, 10);
//   return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
// };

// type WhatsAppTemplateVariableOverrides = Record<string, string>;

// const normalizeTemplateVariableOverrides = (
//   input: unknown,
// ): WhatsAppTemplateVariableOverrides => {
//   if (!input || typeof input !== "object") return {};
//   const raw = input as Record<string, unknown>;
//   const normalized: WhatsAppTemplateVariableOverrides = {};

//   for (const [key, value] of Object.entries(raw)) {
//     const index = Number.parseInt(key, 10);
//     if (!Number.isInteger(index) || index <= 0) continue;

//     const trimmed =
//       typeof value === "string" ? value.trim() : String(value ?? "").trim();
//     if (!trimmed) continue;

//     normalized[String(index)] = trimmed;
//   }

//   return normalized;
// };

// const applyTemplateVariableOverrides = (
//   params: string[],
//   overrides: unknown,
// ): string[] => {
//   const normalized = normalizeTemplateVariableOverrides(overrides);
//   const entries = Object.entries(normalized);
//   if (!entries.length) return params;

//   let next = [...params];
//   for (const [key, value] of entries) {
//     const index = Number.parseInt(key, 10);
//     if (!Number.isInteger(index) || index <= 0) continue;

//     const targetIndex = index - 1;
//     if (targetIndex >= next.length) continue;
//     next[targetIndex] = value;
//   }

//   return next;
// };

// const getTemplateSpecificPassUrlMode = (templateName?: string) => {
//   const normalizedTemplate = String(templateName || "")
//     .toLowerCase()
//     .trim();
//   const envKey = templateName
//     ? `TWILIO_WHATSAPP_PASS_URL_MODE_${String(templateName || "")
//         .toUpperCase()
//         .replace(/[^A-Z0-9]+/g, "_")}`
//     : "";

//   // Template-specific override first (safest).
//   const templateOverride = envKey ? String(process.env[envKey] || "") : "";
//   const templateOverrideTrimmed = templateOverride.toLowerCase().trim();
//   if (templateOverrideTrimmed) return templateOverrideTrimmed;

//   // Hard defaults for templates that embed the bucket prefix in the template button URL.
//   // We intentionally do NOT let the global TWILIO_WHATSAPP_PASS_URL_MODE override these,
//   // because it can easily break templates like:
//   // https://.../qr_codes/email_png/{{n}}
//   if (
//     normalizedTemplate === "rsvp_followup" ||
//     normalizedTemplate === "wedding_invite"
//   ) {
//     return "qr_email_png_suffix";
//   }

//   const globalConfigured = String(
//     process.env.TWILIO_WHATSAPP_PASS_URL_MODE || "",
//   );
//   const globalTrimmed = globalConfigured.toLowerCase().trim();
//   if (globalTrimmed) return globalTrimmed;

//   return "full_url";
// };

// const normalizePassUrlVariableValue = (
//   passUrl?: string | null,
//   templateName?: string,
// ) => {
//   if (!passUrl) return "";

//   const mode = getTemplateSpecificPassUrlMode(templateName);

//   if (mode === "full_url") return passUrl;

//   try {
//     const url = new URL(passUrl);
//     const normalizedPath = url.pathname.replace(/^\/+/, "");
//     if (mode === "path") return normalizedPath;

//     if (mode === "qr_email_png_suffix") {
//       const marker = "qr_codes/email_png/";
//       const idx = normalizedPath.indexOf(marker);
//       if (idx >= 0) return normalizedPath.slice(idx + marker.length);
//       return normalizedPath;
//     }

//     return normalizedPath;
//   } catch {
//     const trimmed = String(passUrl || "").replace(/^\/+/, "");
//     if (mode === "path") return trimmed;

//     if (mode === "qr_email_png_suffix") {
//       const marker = "qr_codes/email_png/";
//       const idx = trimmed.indexOf(marker);
//       if (idx >= 0) return trimmed.slice(idx + marker.length);
//       return trimmed;
//     }

//     return passUrl;
//   }
// };

// const normalizeHeaderMediaVariableValue = (mediaUrl?: string | null) => {
//   if (!mediaUrl) return "";
//   try {
//     const url = new URL(mediaUrl);
//     return url.pathname.replace(/^\/+/, "");
//   } catch {
//     return String(mediaUrl || "").replace(/^\/+/, "").trim();
//   }
// };

// export const getDefaultWhatsAppTemplateName = () =>
//   getConfiguredWhatsAppProvider() === "twilio"
//     ? process.env.TWILIO_DEFAULT_TEMPLATE_NAME ||
//       (String(process.env.TWILIO_CONTENT_SID_WEDDING_INVITE || "").trim()
//         ? "wedding_invite"
//         : String(process.env.TWILIO_CONTENT_SID_RSVP_FOLLOWUP || "").trim()
//           ? "rsvp_followup"
//           : String(
//                 process.env.TWILIO_CONTENT_SID_EVENT_DETAILS_REMINDER || "",
//               ).trim()
//             ? "event_details_reminder"
//             : String(process.env.TWILIO_CONTENT_SID_LOGISTICS || "").trim()
//               ? "logistics"
//               : "event_pass")
//     : "event_invitation";



// const resolveEventPassHeaderValue = ({
//   templateName,
//   headerValue,
//   eventName,
//   eventIv,
//   passUrl,
// }: {
//   templateName: string;
//   headerValue?: string | null;
//   eventName: string;
//   eventIv?: string | null;
//   passUrl?: string | null;
// }) => {
//   if (typeof headerValue === "string" && headerValue.trim()) {
//     return headerValue.trim();
//   }
//   return eventName || "Our Event";
// };

// export const formatWhatsAppEventDateTime = (rawValue?: string | null) => {
//   const fallbackTime = process.env.TWILIO_WHATSAPP_TIME_FALLBACK || "TBA";

//   if (!rawValue) {
//     return { dateLabel: "TBA", timeLabel: fallbackTime };
//   }

//   const trimmed = String(rawValue).trim();
//   const parsed = new Date(trimmed);

//   if (Number.isNaN(parsed.getTime())) {
//     return {
//       dateLabel: trimmed,
//       timeLabel: hasExplicitTime(trimmed) ? trimmed : fallbackTime,
//     };
//   }

//   const dateLabel = new Intl.DateTimeFormat("en-US", {
//     weekday: "long",
//     month: "long",
//     day: "numeric",
//     year: "numeric",
//   }).format(parsed);

//   const timeLabel =
//     hasExplicitTime(trimmed) ||
//     parsed.getHours() !== 0 ||
//     parsed.getMinutes() !== 0
//       ? new Intl.DateTimeFormat("en-US", {
//           hour: "numeric",
//           minute: "2-digit",
//         }).format(parsed)
//       : fallbackTime;

//   return { dateLabel, timeLabel };
// };

// type BuildParamsArgs = {
//   templateName: string;
//   recipientName: string;
//   eventName: string;
//   location?: string | null;
//   eventDate?: string | null;
//   passUrl?: string | null;
//   signoff?: string | null;
//   headerValue?: string | null;
//   eventIv?: string | null;
//   templateVariables?: WhatsAppTemplateVariableOverrides | null;
// };

// export const buildWhatsAppTemplateParams = ({
//   templateName,
//   recipientName,
//   eventName,
//   location,
//   eventDate,
//   passUrl,
//   signoff,
//   headerValue,
//   eventIv,
//   templateVariables,
// }: BuildParamsArgs): string[] => {
//   const { dateLabel, timeLabel } = formatWhatsAppEventDateTime(eventDate);

//   if (/^event_invitation/i.test(templateName)) {
//     const params = [
//       recipientName || "Guest",
//       eventName || "Our Event",
//       location || "TBA",
//       dateLabel,
//       timeLabel,
//       eventIv || "",
//     ];
//     return applyTemplateVariableOverrides(params, templateVariables);
//   }

//   if (/^event_reminder/i.test(templateName)) {
//     const params = [
//       recipientName || "Guest",
//       eventName || "Our Event",
//       location || "TBA",
//       dateLabel,
//       timeLabel,
//     ];
//     return applyTemplateVariableOverrides(params, templateVariables);
//   }

//   if (/^event_details_reminder/i.test(templateName)) {
//     const params = [
//       recipientName || "Guest", // {{1}} - AUTO: guest name (locked)
//       eventName || "Our Event", // {{2}} - frontend editable
//       location || "TBA",        // {{3}} - frontend editable
//       dateLabel,                // {{4}} - frontend editable
//       timeLabel,                // {{5}} - frontend editable
//     ];
//     // Lock variable 1
//     const filtered = normalizeTemplateVariableOverrides(templateVariables);
//     delete filtered["1"];
//     return applyTemplateVariableOverrides(params, filtered);
//   }

//   if (/^rsvp_followup/i.test(templateName)) {
//     const passSuffix = normalizePassUrlVariableValue(
//       passUrl || "",
//       templateName,
//     );
//     const params = [
//       recipientName || "Guest", // {{1}} - AUTO: guest name (locked)
//       eventName || "Our Event", // {{2}} - frontend editable
//       location || "TBA",        // {{3}} - frontend editable
//       dateLabel,                // {{4}} - frontend editable
//       timeLabel,                // {{5}} - frontend editable
//       passSuffix,               // {{6}} - AUTO: button URL (locked)
//     ];
//     // Lock variables 1 and 6
//     const filtered = normalizeTemplateVariableOverrides(templateVariables);
//     delete filtered["1"];
//     delete filtered["6"];
//     return applyTemplateVariableOverrides(params, filtered);
//   }

//   if (/^logistics/i.test(templateName)) {
//     const params = [
//       recipientName || "Guest", // {{1}} - AUTO: guest name (locked)
//       eventName || "Our Event", // {{2}} - frontend editable
//     ];
//     // Lock variable 1
//     const filtered = normalizeTemplateVariableOverrides(templateVariables);
//     delete filtered["1"];
//     return applyTemplateVariableOverrides(params, filtered);
//   }

//   if (/^wedding_invite/i.test(templateName)) {
//     const passSuffix = normalizePassUrlVariableValue(
//       passUrl || "",
//       templateName,
//     );
//     const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
//     const params = Array.from({ length: 9 }, () => "");
//     params[0] = eventName || "Our Event"; // {{1}} - frontend editable (header text)
//     params[1] = recipientName || "Guest"; // {{2}} - AUTO: guest name (locked)
//     params[2] = signoff || eventName || "SoftInvites"; // {{3}} - frontend editable
//     params[3] = eventName || "Our Event"; // {{4}} - frontend editable
//     params[4] = dateLabel;                // {{5}} - frontend editable
//     params[5] = timeLabel;                // {{6}} - frontend editable
//     params[6] = location || "TBA";        // {{7}} - frontend editable
//     params[7] = headerMediaKey;           // {{8}} - AUTO: header media key (locked)
//     params[8] = passSuffix;               // {{9}} - AUTO: pass URL suffix (locked)

//     // Only allow overrides for variables 1,3,4,5,6,7 — lock 2,8,9
//     const filtered = normalizeTemplateVariableOverrides(templateVariables);
//     delete filtered["2"];
//     delete filtered["8"];
//     delete filtered["9"];
//     return applyTemplateVariableOverrides(params, filtered);
//   }

//   if (/^event_pass/i.test(templateName)) {
//     if (isEventPassLegacyModeEnabled()) {
//       const params = [
//         recipientName || "Guest",
//         eventName || "Our Event",
//         location || "TBA",
//         dateLabel,
//         timeLabel,
//         signoff || "SoftInvites",
//       ];

//       const passUrlVariableIndex = getPassUrlVariableIndex(templateName);
//       if (
//         passUrlVariableIndex &&
//         passUrlVariableIndex > params.length &&
//         passUrl
//       ) {
//         params[passUrlVariableIndex - 1] = normalizePassUrlVariableValue(
//           passUrl,
//           templateName,
//         );
//       }
//       return applyTemplateVariableOverrides(params, templateVariables);
//     }

//     const passUrlVariableIndex = getPassUrlVariableIndex(templateName) || 8;
//     const minLength = Math.max(8, passUrlVariableIndex);
//     const params = Array.from({ length: minLength }, () => "");

//     params[0] = resolveEventPassHeaderValue({
//       templateName,
//       headerValue,
//       eventName,
//       eventIv,
//       passUrl,
//     });
//     params[1] = recipientName || "Guest";
//     params[2] = eventName || "Our Event";
//     params[3] = location || "TBA";
//     params[4] = dateLabel;
//     params[5] = timeLabel;
//     params[6] = signoff || "SoftInvites";

//     if (passUrl) {
//       params[passUrlVariableIndex - 1] = normalizePassUrlVariableValue(
//         passUrl,
//         templateName,
//       );
//     }

//     return applyTemplateVariableOverrides(params, templateVariables);
//   }

//   const params = [
//     recipientName || "Guest",
//     eventName || "Our Event",
//     location || "TBA",
//     dateLabel,
//     timeLabel,
//   ];
//   return applyTemplateVariableOverrides(params, templateVariables);
// };

const getConfiguredWhatsAppProvider = () =>
  (
    process.env.WHATSAPP_PROVIDER ||
    (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "meta")
  ).toLowerCase();

const isEventPassLegacyModeEnabled = () =>
  String(process.env.TWILIO_EVENT_PASS_LEGACY_MODE || "").toLowerCase() ===
  "true";

const hasExplicitTime = (value: string) =>
  /\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i.test(value);

const getPassUrlVarIndexEnvKey = (templateName: string) =>
  `TWILIO_WHATSAPP_PASS_URL_VAR_INDEX_${String(templateName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;

const getHeaderMediaVarIndexEnvKey = (templateName: string) =>
  `TWILIO_WHATSAPP_HEADER_MEDIA_VAR_INDEX_${String(templateName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;

const getPassUrlVariableIndex = (templateName?: string) => {
  const templateOverrideKey = templateName
    ? getPassUrlVarIndexEnvKey(templateName)
    : "";
  const rawValue =
    (templateOverrideKey ? process.env[templateOverrideKey] : undefined) ||
    process.env.TWILIO_WHATSAPP_PASS_URL_VAR_INDEX;
  if (!rawValue) {
    // Defaults based on templates we ship today.
    const normalizedTemplate = String(templateName || "")
      .toLowerCase()
      .trim();
    if (normalizedTemplate === "rsvp_followup") return 6;
    return 8;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
};

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

  // Template-specific override first (safest).
  const templateOverride = envKey ? String(process.env[envKey] || "") : "";
  const templateOverrideTrimmed = templateOverride.toLowerCase().trim();
  if (templateOverrideTrimmed) return templateOverrideTrimmed;

  // Hard defaults for templates that embed the bucket prefix in the template button URL.
  // We intentionally do NOT let the global TWILIO_WHATSAPP_PASS_URL_MODE override these,
  // because it can easily break templates like:
  // https://.../qr_codes/email_png/{{n}}
  if (
    normalizedTemplate === "rsvp_followup" ||
    normalizedTemplate === "wedding_invite"
  ) {
    return "qr_email_png_suffix";
  }

  // rsvp_party and rsvp_wedding receive a raw RSVP _id as passUrl
  // so return it as-is (full_url mode)
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

const normalizeHeaderMediaVariableValue = (mediaUrl?: string | null) => {
  if (!mediaUrl) return "";
  try {
    const url = new URL(mediaUrl);
    // Re-encode the pathname so special characters (spaces, apostrophes, etc.)
    // are percent-encoded and won't break Twilio's ContentVariables JSON parsing.
    const rawPath = url.pathname.replace(/^\/+/, "");
    return rawPath.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
  } catch {
    const raw = String(mediaUrl || "").replace(/^\/+/, "").trim();
    return raw.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
  }
};

export const getDefaultWhatsAppTemplateName = () =>
  getConfiguredWhatsAppProvider() === "twilio"
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

export const formatWhatsAppEventDateTime = (rawValue?: string | null) => {
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

import {
  buildDynamicTemplateParams,
  VariableDefinition,
} from "./dynamicTemplateBuilder.js";

const HARDCODED_TEMPLATE_PATTERNS = [
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

const isHardcodedTemplate = (templateName: string) =>
  HARDCODED_TEMPLATE_PATTERNS.some((rx) => rx.test(templateName || ""));

type BuildParamsArgs = {
  templateName: string;
  recipientName: string;
  eventName: string;
  location?: string | null;
  eventDate?: string | null;
  passUrl?: string | null;
  signoff?: string | null;
  headerValue?: string | null;
  eventIv?: string | null;
  templateVariables?: WhatsAppTemplateVariableOverrides | null;
  customDefinition?: VariableDefinition[] | null;
};

export const buildWhatsAppTemplateParams = ({
  templateName,
  recipientName,
  eventName,
  location,
  eventDate,
  passUrl,
  signoff,
  headerValue,
  eventIv,
  templateVariables,
  customDefinition,
}: BuildParamsArgs): string[] => {
  const { dateLabel, timeLabel } = formatWhatsAppEventDateTime(eventDate);

  // If the caller supplied a DB definition (an APPROVED Manager template was
  // found for this name), use the data-driven builder. This applies even when
  // the name matches a hardcoded template — an approved Manager template
  // overrides the built-in one. When no DB definition is supplied, the
  // hardcoded branches below run exactly as before (backward compatible).
  if (Array.isArray(customDefinition) && customDefinition.length > 0) {
    return buildDynamicTemplateParams(
      customDefinition,
      {
        recipientName,
        eventName,
        location,
        dateLabel,
        timeLabel,
        signoff,
        eventIv,
        passUrl,
      },
      templateVariables,
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

  if (/^event_details_reminder/i.test(templateName)) {
    const params = [
      recipientName || "Guest", // {{1}} - AUTO: guest name (locked)
      eventName || "Our Event", // {{2}} - frontend editable
      location || "TBA",        // {{3}} - frontend editable
      dateLabel,                // {{4}} - frontend editable
      timeLabel,                // {{5}} - frontend editable
    ];
    // Lock variable 1
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["1"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^rsvp_party/i.test(templateName)) {
    // rsvp_party: 9 variables
    // {{1}} event title, {{2}} AUTO guest name, {{3}} event name, {{4}} event name,
    // {{5}} date, {{6}} time, {{7}} AUTO header image, {{8}} AUTO rsvpId?status=yes, {{9}} AUTO rsvpId?status=no
    const rsvpId = normalizePassUrlVariableValue(passUrl || "", templateName);
    const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
    const params = [
      eventName || "Our Event",        // {{1}} frontend editable
      recipientName || "Guest",        // {{2}} AUTO: guest name (locked)
      eventName || "Our Event",        // {{3}} frontend editable
      eventName || "Our Event",        // {{4}} frontend editable
      dateLabel,                       // {{5}} frontend editable
      timeLabel,                       // {{6}} frontend editable
      headerMediaKey || " ",           // {{7}} AUTO: S3 image key (locked)
      rsvpId ? `${rsvpId}?status=yes` : " ", // {{8}} AUTO: rsvpId?status=yes (locked)
      rsvpId ? `${rsvpId}?status=no` : " ",  // {{9}} AUTO: rsvpId?status=no (locked)
    ];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["2"];
    delete filtered["7"];
    delete filtered["8"];
    delete filtered["9"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^rsvp_wedding/i.test(templateName)) {
    // rsvp_wedding: 11 variables
    // {{1}} event title, {{2}} AUTO guest name, {{3}} host/family, {{4}} ceremony type,
    // {{5}} couple names, {{6}} date, {{7}} time, {{8}} venue,
    // {{9}} AUTO header image, {{10}} AUTO rsvpId?status=yes, {{11}} AUTO rsvpId?status=no
    const rsvpId = normalizePassUrlVariableValue(passUrl || "", templateName);
    const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
    const params = [
      eventName || "Our Event",            // {{1}} frontend editable
      recipientName || "Guest",            // {{2}} AUTO: guest name (locked)
      signoff || eventName || "Our Family",// {{3}} frontend editable
      eventName || "Our Event",            // {{4}} frontend editable
      eventName || "the couple",           // {{5}} frontend editable
      dateLabel,                           // {{6}} frontend editable
      timeLabel,                           // {{7}} frontend editable
      location || "TBA",                   // {{8}} frontend editable
      headerMediaKey || " ",               // {{9}} AUTO: S3 image key (locked)
      rsvpId ? `${rsvpId}?status=yes` : " ", // {{10}} AUTO: rsvpId?status=yes (locked)
      rsvpId ? `${rsvpId}?status=no` : " ",  // {{11}} AUTO: rsvpId?status=no (locked)
    ];
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["2"];
    delete filtered["9"];
    delete filtered["10"];
    delete filtered["11"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^rsvp_form/i.test(templateName)) {
    // rsvp_form: 8 variables
    // {{1}} event title, {{2}} AUTO guest name, {{3}} event name,
    // {{4}} AUTO date, {{5}} AUTO time, {{6}} venue,
    // {{7}} AUTO header image S3 key, {{8}} AUTO RSVP form link path
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
    const passSuffix = normalizePassUrlVariableValue(
      passUrl || "",
      templateName,
    );
    const params = [
      recipientName || "Guest", // {{1}} - AUTO: guest name (locked)
      eventName || "Our Event", // {{2}} - frontend editable
      location || "TBA",        // {{3}} - frontend editable
      dateLabel,                // {{4}} - frontend editable
      timeLabel,                // {{5}} - frontend editable
      passSuffix,               // {{6}} - AUTO: button URL (locked)
    ];
    // Lock variables 1 and 6
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["1"];
    delete filtered["6"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^logistics/i.test(templateName)) {
    const params = [
      recipientName || "Guest", // {{1}} - AUTO: guest name (locked)
      eventName || "Our Event", // {{2}} - frontend editable
    ];
    // Lock variable 1
    const filtered = normalizeTemplateVariableOverrides(templateVariables);
    delete filtered["1"];
    return applyTemplateVariableOverrides(params, filtered);
  }

  if (/^wedding_invite/i.test(templateName)) {
    // {{10}} = S3 path of event invitation image (header media)
    const headerMediaKey = normalizeHeaderMediaVariableValue(eventIv || "");
    // {{11}} = suffix after "qr_codes/email_png/" for the View Digital Pass button
    const passSuffix = normalizePassUrlVariableValue(passUrl || "", templateName);

    // 11 variables – Twilio requires all to be non-empty strings
    const params = Array.from({ length: 11 }, () => "");
    params[0]  = eventName || "Event Name";                                          // {{1}}  event title (frontend editable)
    params[1]  = recipientName || "Guest";                                          // {{2}}  guest name (AUTO – locked)
    params[2]  = (templateVariables?.["3"]) || signoff || eventName || "Couple's Family Name"; // {{3}}  host/family name (frontend editable)
    params[3]  = (templateVariables?.["4"]) || eventName || "Traditional or White Wedding";             // {{4}}  ceremony type (frontend editable)
    params[4]  = (templateVariables?.["5"]) || eventName || "of their Event Name";            // {{5}}  couple names (frontend editable)
    params[5]  = (templateVariables?.["6"]) || "Ceremony Details";                          // {{6}}  ceremony label e.g. "Church Ceremony" (frontend editable)
    params[6]  = (templateVariables?.["7"]) || dateLabel || "Date";                  // {{7}}  date (frontend editable)
    params[7]  = (templateVariables?.["8"]) || timeLabel || "Time";                  // {{8}}  time (frontend editable)
    params[8]  = (templateVariables?.["9"]) || location || "Location";                   // {{9}}  venue (frontend editable)
    params[9]  = headerMediaKey || "WhatsApp+Image+2026-04-21+at+08.19.49.jpeg";    // {{10}} S3 image path (AUTO – locked)
    params[10] = passSuffix || "missing.png";                                       // {{11}} pass URL suffix (AUTO – locked)

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
        signoff || "SoftInvites",
      ];

      const passUrlVariableIndex = getPassUrlVariableIndex(templateName);
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

    const passUrlVariableIndex = getPassUrlVariableIndex(templateName) || 8;
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
    params[6] = signoff || "SoftInvites";

    if (passUrl) {
      params[passUrlVariableIndex - 1] = normalizePassUrlVariableValue(
        passUrl,
        templateName,
      );
    }

    return applyTemplateVariableOverrides(params, templateVariables);
  }

  const params = [
    recipientName || "Guest",
    eventName || "Our Event",
    location || "TBA",
    dateLabel,
    timeLabel,
  ];
  return applyTemplateVariableOverrides(params, templateVariables);
};
