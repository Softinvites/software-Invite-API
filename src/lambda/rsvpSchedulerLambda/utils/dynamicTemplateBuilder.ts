// Mirror of src/utils/dynamicTemplateBuilder.ts for the rsvpScheduler lambda.
// Kept in sync so that DB-stored Twilio Content templates work without code changes.

export const AUTO_SOURCES = [
  "guest_name",
  "event_title",
  "event_date",
  "event_time",
  "event_venue",
  "guest_table_no",
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
  /** Guest.TableNo — per-guest, unlike every other field here. */
  tableNo?: string | null;
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

/**
 * RSVP variables must carry only the token — the approved button URL already
 * supplies the base, e.g. https://www.softinvite.com/rsvp/respond/{{10}}.
 *
 * Callers hand us passUrl in two different shapes: a bare token (guest sends)
 * or a full link like https://www.softinvite.com/rsvp/<token> (the scheduler's
 * rsvpLink). The hardcoded template branches ran the latter through
 * normalizePassUrlVariableValue first; this data-driven path did not, so the
 * whole URL was substituted into the button and produced
 * .../rsvp/respond/https:/www.softinvite.com/rsvp/<token>?status=yes
 */
const extractRsvpToken = (value?: string | null): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split(/[?#]/)[0];
  if (!withoutQuery.includes("/")) return withoutQuery;
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments[segments.length - 1] || "";
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
    case "guest_table_no":
      // Never return "" — Twilio/Meta reject empty template parameters.
      return ctx.tableNo || "TBA";
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
      return extractRsvpToken(ctx.passUrl);
    case "rsvp_yes_link": {
      const id = extractRsvpToken(ctx.passUrl);
      return id ? `${id}?status=yes` : "";
    }
    case "rsvp_no_link": {
      const id = extractRsvpToken(ctx.passUrl);
      return id ? `${id}?status=no` : "";
    }
    case "rsvp_form_path":
      return ctx.passUrl || "";
    default:
      return "";
  }
};

/**
 * Does this template need a server-side RSVP form link minted for it?
 *
 * Name-matching alone was the bug: a template built in the Manager under any
 * other name that declares an `rsvp_form_path` variable still needs a link, or
 * that variable sends empty and Twilio rejects the message. Detect it from the
 * definition, and keep the legacy name check for templates with no DB row.
 */
export const templateNeedsRsvpFormLink = (
  templateName?: string | null,
  variableDefinitions?: VariableDefinition[] | null,
): boolean => {
  if (/^rsvp_form/i.test(String(templateName || ""))) return true;
  return Array.isArray(variableDefinitions)
    ? variableDefinitions.some((d) => d?.autoSource === "rsvp_form_path")
    : false;
};

/**
 * Where an RSVP form link should land: an explicit per-send/per-schedule URL
 * wins, then the event-level default, then our own hosted form.
 *
 * The WhatsApp button URL is fixed at approval time and cannot point at an
 * arbitrary domain, so an external form is reached by redirecting our own
 * /r/<token> route. That keeps per-guest attribution before forwarding.
 */
export const resolveExternalFormUrl = (
  explicit?: string | null,
  event?: { rsvpFormSettings?: Record<string, any> | null } | null,
): string | null => {
  const pick = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return (
    pick(explicit) ?? pick((event?.rsvpFormSettings as any)?.externalFormUrl) ?? null
  );
};

/**
 * Auto sources whose value is per-guest or system-derived. A sender override on
 * any of these would stamp a single hand-typed value across the whole batch —
 * every guest receiving the same QR pass, table number or RSVP link. They are
 * therefore always treated as locked, whether or not the template author
 * remembered to tick "Locked" in the builder.
 *
 * Event-level sources (title, date, time, venue, signoff) are deliberately NOT
 * here: those are the same for everyone, so letting a sender adjust them is the
 * whole point of the override box.
 */
export const ALWAYS_LOCKED_AUTO_SOURCES = new Set<string>([
  "guest_name",
  "guest_table_no",
  "event_iv",
  "header_media_path",
  "qr_pass_url",
  "qr_pass_suffix",
  "rsvp_id_raw",
  "rsvp_yes_link",
  "rsvp_no_link",
  "rsvp_form_path",
]);

export const isEffectivelyLocked = (
  def: VariableDefinition | null | undefined,
): boolean =>
  !!def?.locked ||
  (!!def?.autoSource && ALWAYS_LOCKED_AUTO_SOURCES.has(String(def.autoSource)));

/**
 * A variable that appears in the template's header media URL can only ever be
 * the media path — there is nothing else it could hold.
 *
 * The builder derives its editable variable rows from the body text, so a
 * header-only variable never gets a row, and saves with label "", autoSource
 * null, locked false. That made the Send dialog offer it as an unlabelled,
 * editable field, and worse, it resolved to an empty string at send time.
 *
 * Infer it instead of relying on the author to have set it. Applied on read as
 * well as on save, so templates already approved are corrected without anyone
 * having to edit and resubmit them.
 */
export const applyHeaderMediaDefaults = (
  defs: VariableDefinition[] | null | undefined,
  headerMediaUrl?: string | null,
): VariableDefinition[] => {
  const list = Array.isArray(defs) ? defs : [];
  const match = String(headerMediaUrl || "").match(/\{\{(\d+)\}\}/);
  if (!match) return list;

  const headerIndex = Number(match[1]);
  return list.map((d) =>
    d && d.index === headerIndex && !d.autoSource
      ? {
          ...d,
          autoSource: "header_media_path",
          locked: true,
          label: d.label || "Header media (auto)",
        }
      : d,
  );
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

    if (isEffectivelyLocked(def)) {
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
