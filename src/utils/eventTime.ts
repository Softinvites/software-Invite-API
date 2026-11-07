/**
 * Recovering an event's time of day.
 *
 * The Event model has no time field — time is typed by an admin into a
 * WhatsApp template variable or written into a message body as a "Time:" line.
 * Calendar invites were therefore defaulting to midnight UTC, which surfaced to
 * guests as a 1–3am appointment in local time.
 *
 * These helpers dig the time back out of whatever text the event actually
 * carries, and parse the many shapes admins type it in.
 */

export type ParsedTime = { hours: number; minutes: number };

/**
 * Parses a clock time from free text. Handles 11:00pm, 11.00 PM, 11 pm,
 * 23:00, "23:00 pm" (meridiem ignored when the hour is already 24h), 6:00 P.M.
 * Returns null when nothing time-like is present.
 */
export const parseTimeOfDay = (value?: string | null): ParsedTime | null => {
  const text = String(value || "").trim();
  if (!text) return null;

  // hour, optional :mm / .mm, optional am/pm (with or without dots/spaces)
  const match = text.match(
    /\b(\d{1,2})\s*(?:[:.]\s*([0-5]\d))?\s*([ap])\s*\.?\s*m\b\.?|\b(\d{1,2})\s*[:.]\s*([0-5]\d)\b/i,
  );
  if (!match) return null;

  let hours: number;
  let minutes: number;
  let meridiem: string | null = null;

  if (match[1] !== undefined) {
    hours = Number(match[1]);
    minutes = Number(match[2] ?? 0);
    meridiem = String(match[3] || "").toLowerCase();
  } else {
    hours = Number(match[4]);
    minutes = Number(match[5] ?? 0);
  }

  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;

  // "23:00 pm" is a common typo — the hour is already 24-hour, so the
  // meridiem is noise. Only apply it when the hour is a 12-hour clock value.
  if (meridiem && hours <= 12) {
    if (meridiem === "p" && hours !== 12) hours += 12;
    if (meridiem === "a" && hours === 12) hours = 0;
  }

  return { hours, minutes };
};

/**
 * Strips HTML so a time can be found in email bodies, which arrive as markup
 * such as `<p>Time: 11:00pm</p>`. Block-level tags become newlines so that
 * "Time:" and its value don't run into the surrounding text.
 */
export const stripHtml = (value?: string | null): string =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ");

/**
 * Pulls the time from a "Time: ..." label, which is how both message bodies
 * and email templates write it.
 *
 * HTML is stripped first, and the value is allowed to sit on the line after
 * the label — `<p>Time:</p><p>11:00pm</p>` is common in rich-text editors.
 * parseTimeOfDay takes the first time-like token in the captured window, so a
 * following "Venue:" line cannot be mistaken for the time.
 */
export const parseLabelledTime = (value?: string | null): ParsedTime | null => {
  const text = stripHtml(value);
  if (!text.trim()) return null;
  const labelled = text.match(/\btime\s*[:\-]\s*([\s\S]{0,40})/i);
  if (labelled) {
    const parsed = parseTimeOfDay(labelled[1]);
    if (parsed) return parsed;
  }
  return null;
};

/**
 * Tries a labelled "Time:" first (unambiguous), then any bare clock value.
 * Bare parsing is only used for short strings such as a template variable
 * whose whole value is the time — never for long prose, where a stray number
 * could be misread.
 */
export const extractTime = (value?: string | null): ParsedTime | null => {
  const labelled = parseLabelledTime(value);
  if (labelled) return labelled;

  const text = String(value || "").trim();
  if (!text || text.length > 40) return null;
  return parseTimeOfDay(text);
};

/**
 * SoftInvites events run out of Lagos, and admins type times in local clock
 * time. Nigeria is UTC+1 all year with no daylight saving, so a fixed offset
 * is exact rather than an approximation.
 *
 * Override with EVENT_TIMEZONE_OFFSET_MINUTES if events ever run elsewhere.
 */
export const getEventUtcOffsetMinutes = (): number => {
  const raw = Number(process.env.EVENT_TIMEZONE_OFFSET_MINUTES);
  return Number.isFinite(raw) ? raw : 60; // Africa/Lagos = UTC+1
};

/**
 * Applies a local (Africa/Lagos) time of day to a date and returns the UTC
 * instant. setUTCHours handles rollover, so 00:30 Lagos correctly becomes
 * 23:30 UTC on the previous day.
 */
export const applyTimeOfDay = (date: Date, time: ParsedTime): Date => {
  const next = new Date(date.getTime());
  next.setUTCHours(time.hours, time.minutes - getEventUtcOffsetMinutes(), 0, 0);
  return next;
};

/**
 * Finds an event's time of day by searching every place an admin may have
 * typed it, most explicit first:
 *
 *   1. scheduled-message template variables (what the Send dialog collected)
 *   2. scheduled-message bodies ("Time: 11:00pm")
 *   3. the event's own custom message sequence bodies
 *   4. the event's RSVP message
 *
 * The event date string and description are deliberately NOT consulted: the
 * date field is not where the real time is kept, and the description is prose
 * that can easily contain an unrelated number.
 *
 * Returns null when the event genuinely has no time recorded anywhere, in
 * which case callers should keep their existing all-day behaviour.
 */

export const resolveEventTimeOfDay = async (
  event: any,
  MessageScheduleModel?: any,
  options?: {
    /** Stored email templates for this event (model, queried lazily). */
    EmailTemplateModel?: any;
    /** Highest-priority text, e.g. the guest's own invitation message. */
    extraSources?: (string | null | undefined)[];
  },
): Promise<ParsedTime | null> => {
  // Most specific first: text written for this particular guest.
  for (const source of options?.extraSources || []) {
    const parsed = parseLabelledTime(source);
    if (parsed) return parsed;
  }

  if (MessageScheduleModel && event?._id) {
    try {
      const schedules = await MessageScheduleModel.find({ eventId: event._id })
        .select({ templateVariables: 1, messageBody: 1 })
        .sort({ createdAt: -1 })
        .limit(25)
        .lean();

      for (const schedule of schedules || []) {
        const vars = schedule?.templateVariables;
        if (vars && typeof vars === "object") {
          for (const raw of Object.values(vars)) {
            const parsed = extractTime(typeof raw === "string" ? raw : "");
            if (parsed) return parsed;
          }
        }
      }
      for (const schedule of schedules || []) {
        const parsed = parseLabelledTime(schedule?.messageBody);
        if (parsed) return parsed;
      }
    } catch {
      /* best effort — fall through to the event's own text */
    }
  }

  const sequence = Array.isArray(event?.customMessageSequence)
    ? event.customMessageSequence
    : [];
  for (const step of sequence) {
    const parsed = parseLabelledTime(step?.messageBody);
    if (parsed) return parsed;
  }

  // Stored email templates — this is where the time lives for email-only
  // events that never used a WhatsApp template variable.
  if (options?.EmailTemplateModel && event?._id) {
    try {
      const templates = await options.EmailTemplateModel.find({
        eventId: event._id,
      })
        .select({ html: 1 })
        .sort({ createdAt: -1 })
        .limit(25)
        .lean();

      for (const template of templates || []) {
        const parsed = parseLabelledTime(stripHtml(template?.html));
        if (parsed) return parsed;
      }
    } catch {
      /* best effort */
    }
  }

  return parseLabelledTime(event?.rsvpMessage) || null;
};
