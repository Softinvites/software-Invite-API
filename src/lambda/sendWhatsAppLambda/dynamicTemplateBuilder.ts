// Mirror of src/utils/dynamicTemplateBuilder.ts for the sendWhatsApp lambda.
// Kept in sync so DB-stored Twilio Content templates send correctly without
// code changes when admins create new ones from the Template Manager UI.

export const AUTO_SOURCES = [
  "guest_name",
  "event_title",
  "event_date",
  "event_time",
  "event_venue",
  "event_signoff",
  "event_iv",
  "header_media_path",
  "qr_pass_url",
  "qr_pass_suffix",
  "rsvp_id_raw",
  "rsvp_yes_link",
  "rsvp_no_link",
  "rsvp_form_path",
  "manual",
] as const;

export type AutoSource = (typeof AUTO_SOURCES)[number] | null;

export type VariableDefinition = {
  index: number;
  label?: string;
  autoSource?: AutoSource | string | null;
  locked?: boolean;
  defaultValue?: string;
};

export type AutoContext = {
  recipientName?: string | null;
  eventName?: string | null;
  location?: string | null;
  dateLabel?: string | null;
  timeLabel?: string | null;
  signoff?: string | null;
  eventIv?: string | null;
  passUrl?: string | null;
};

const normalizeHeaderMediaVariableValue = (mediaUrl?: string | null) => {
  if (!mediaUrl) return "";
  try {
    const url = new URL(mediaUrl);
    const rawPath = url.pathname.replace(/^\/+/, "");
    return rawPath
      .split("/")
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/");
  } catch {
    const raw = String(mediaUrl || "").replace(/^\/+/, "").trim();
    return raw
      .split("/")
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/");
  }
};

const extractQrSuffix = (passUrl?: string | null) => {
  if (!passUrl) return "";
  const markers = ["qr_codes/email_png/", "qr_codes/png/"];
  try {
    const url = new URL(passUrl);
    const path = url.pathname.replace(/^\/+/, "");
    for (const marker of markers) {
      const idx = path.indexOf(marker);
      if (idx >= 0) return path.slice(idx + marker.length);
    }
    return path;
  } catch {
    const trimmed = String(passUrl || "").replace(/^\/+/, "");
    for (const marker of markers) {
      const idx = trimmed.indexOf(marker);
      if (idx >= 0) return trimmed.slice(idx + marker.length);
    }
    return trimmed;
  }
};

export const resolveAutoSourceValue = (
  autoSource: string | null | undefined,
  ctx: AutoContext,
): string => {
  switch (autoSource) {
    case "guest_name":
      return ctx.recipientName || "Guest";
    case "event_title":
      return ctx.eventName || "Our Event";
    case "event_date":
      return ctx.dateLabel || "TBA";
    case "event_time":
      return ctx.timeLabel || "TBA";
    case "event_venue":
      return ctx.location || "TBA";
    case "event_signoff":
      return ctx.signoff || ctx.eventName || "SoftInvites";
    case "event_iv":
      return ctx.eventIv || "";
    case "header_media_path":
      return normalizeHeaderMediaVariableValue(ctx.eventIv || "");
    case "qr_pass_url":
      return ctx.passUrl || "";
    case "qr_pass_suffix":
      return extractQrSuffix(ctx.passUrl || "");
    case "rsvp_id_raw":
      return ctx.passUrl || "";
    case "rsvp_yes_link":
      return ctx.passUrl ? `${ctx.passUrl}?status=yes` : "";
    case "rsvp_no_link":
      return ctx.passUrl ? `${ctx.passUrl}?status=no` : "";
    case "rsvp_form_path":
      return ctx.passUrl || "";
    default:
      return "";
  }
};

export const buildDynamicTemplateParams = (
  variableDefinitions: VariableDefinition[] | null | undefined,
  ctx: AutoContext,
  templateVariables?: Record<string, string> | null,
): string[] => {
  if (!Array.isArray(variableDefinitions) || variableDefinitions.length === 0) {
    return [];
  }

  const sorted = [...variableDefinitions].sort(
    (a, b) => (a.index || 0) - (b.index || 0),
  );
  const maxIndex = sorted.reduce(
    (acc, def) => Math.max(acc, def.index || 0),
    0,
  );
  if (maxIndex <= 0) return [];

  const params = Array.from({ length: maxIndex }, () => "");

  sorted.forEach((def) => {
    if (!def || !def.index || def.index < 1) return;
    const slot = def.index - 1;

    const autoValue = def.autoSource
      ? resolveAutoSourceValue(def.autoSource, ctx)
      : "";

    if (def.locked) {
      params[slot] = autoValue || def.defaultValue || "";
      return;
    }

    const userOverride = templateVariables?.[String(def.index)];
    if (typeof userOverride === "string" && userOverride.trim().length > 0) {
      params[slot] = userOverride.trim();
      return;
    }

    params[slot] = autoValue || def.defaultValue || "";
  });

  return params;
};
