import { MessageSchedule } from "../models/messageSchedule";

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeTargetAudience = (value: any) => {
  if (value === "non-responders") return "pending";
  if (value === "pending-no" || value === "pending_and_no") {
    return "pending-and-no";
  }
  if (
    value === "all" ||
    value === "responders" ||
    value === "yes" ||
    value === "no" ||
    value === "pending" ||
    value === "pending-and-no" ||
    value === "tag"
  ) {
    return value;
  }
  return "all";
};

const normalizeTargetTag = (value: any) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  return trimmed || null;
};

const normalizeSequenceDate = (item: any, baseDate: Date): Date | null => {
  if (item?.scheduledDate) {
    const directDate = new Date(item.scheduledDate);
    if (!Number.isNaN(directDate.getTime())) {
      return directDate;
    }
  }
  if (item?.dayOffset !== undefined && item?.dayOffset !== null) {
    const dayOffset = Number(item.dayOffset);
    if (!Number.isNaN(dayOffset)) {
      return new Date(baseDate.getTime() + dayOffset * DAY_MS);
    }
  }
  return null;
};

const normalizeStepMessageBody = (value: any) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

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

const normalizeSequenceAttachment = (attachment: any) => {
  if (!attachment || typeof attachment !== "object") return null;
  const url =
    typeof attachment.url === "string" ? attachment.url.trim() : "";
  if (!url) return null;
  return {
    url,
    filename:
      typeof attachment.filename === "string"
        ? attachment.filename.trim()
        : null,
    contentType:
      typeof attachment.contentType === "string"
        ? attachment.contentType.trim()
        : null,
  };
};

const normalizeWhatsAppSequenceAttachment = (attachment: any) => {
  const normalizedAttachment = normalizeSequenceAttachment(attachment);
  if (!normalizedAttachment) return null;

  const normalizedType = String(normalizedAttachment.contentType || "")
    .trim()
    .toLowerCase();
  if (normalizedType && IMAGE_ATTACHMENT_CONTENT_TYPES.has(normalizedType)) {
    return normalizedAttachment;
  }

  return isImageAttachmentUrl(normalizedAttachment.url)
    ? normalizedAttachment
    : null;
};

const normalizeTemplateVariables = (value: any): Record<string, string> | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const normalized: Record<string, string> = {};

  for (const [key, entry] of Object.entries(raw)) {
    const index = Number.parseInt(key, 10);
    if (!Number.isInteger(index) || index <= 0) continue;

    const trimmed =
      typeof entry === "string" ? entry.trim() : String(entry ?? "").trim();
    if (!trimmed) continue;

    normalized[String(index)] = trimmed;
  }

  return Object.keys(normalized).length ? normalized : null;
};

type FullScheduleSyncOptions = {
  replacePending?: boolean;
};

type FullScheduleSyncResult = {
  inserted: number;
  deleted: number;
  existingPendingCount: number;
  skipped: boolean;
};

export const syncFullRsvpPendingSchedules = async (
  event: any,
  options: FullScheduleSyncOptions = {},
): Promise<FullScheduleSyncResult> => {
  if (!event?._id) {
    return { inserted: 0, deleted: 0, existingPendingCount: 0, skipped: true };
  }

  const replacePending = options.replacePending !== false;
  const pendingFilter = {
    eventId: event._id,
    status: "pending",
    servicePackage: "full-rsvp",
    messageType: "custom",
  };
  const existingPendingCount = await MessageSchedule.countDocuments(pendingFilter);
  if (!replacePending && existingPendingCount > 0) {
    return { inserted: 0, deleted: 0, existingPendingCount, skipped: true };
  }

  const now = new Date();
  const sequence = Array.isArray(event.customMessageSequence)
    ? event.customMessageSequence
    : [];

  if (!sequence.length) {
    if (replacePending || existingPendingCount > 0) {
      const deletionResult = await MessageSchedule.deleteMany(pendingFilter);
      return {
        inserted: 0,
        deleted: deletionResult.deletedCount || 0,
        existingPendingCount,
        skipped: true,
      };
    }
    return { inserted: 0, deleted: 0, existingPendingCount, skipped: true };
  }

  const schedules: any[] = [];

  for (const item of sequence) {
    const scheduledDate = normalizeSequenceDate(item, now);
    if (!scheduledDate) continue;

    const messageTitle = String(
      item?.messageTitle || item?.messageName || "Custom Message",
    ).trim();
    const messageBody = normalizeStepMessageBody(item?.messageBody);
    if (!messageBody) {
      continue;
    }
    const messageName = String(item?.messageName || messageTitle || "Custom Message").trim();
    const attachment = normalizeSequenceAttachment(item?.attachment);
    const channels = item.channels || { email: { enabled: true } };
    const targetAudience = normalizeTargetAudience(item?.conditions?.audienceType);
    const targetTag =
      targetAudience === "tag"
        ? normalizeTargetTag(item?.conditions?.targetTag)
        : null;
    const eventChannelConfig = (event as any)?.channelConfig || {};
    const channelEntries: Array<{ channel: "email" | "whatsapp" | "bulkSms"; enabled?: boolean }> = [
      { channel: "email", enabled: channels?.email?.enabled !== false },
      {
        channel: "whatsapp",
        enabled:
          !!channels?.whatsapp?.enabled && eventChannelConfig?.whatsapp?.enabled !== false,
      },
      {
        channel: "bulkSms",
        enabled:
          !!channels?.bulkSms?.enabled && eventChannelConfig?.bulkSms?.enabled !== false,
      },
    ];

    for (const ch of channelEntries) {
      if (!ch.enabled) continue;
      const templateVariables =
        ch.channel === "whatsapp"
          ? normalizeTemplateVariables(channels?.whatsapp?.templateVariables)
          : null;
      const redirectUrl =
        ch.channel === "whatsapp" &&
        typeof channels?.whatsapp?.redirectUrl === "string" &&
        channels.whatsapp.redirectUrl.trim()
          ? channels.whatsapp.redirectUrl.trim()
          : null;
      schedules.push({
        eventId: event._id,
        messageType: "custom",
        messageName: messageName || "Custom Message",
        messageTitle: messageTitle || "Custom Message",
        messageBody,
        includeResponseButtons: item?.includeResponseButtons !== false,
        attachment:
          ch.channel === "whatsapp"
            ? normalizeWhatsAppSequenceAttachment(attachment)
            : attachment,
        scheduledDate,
        status: "pending",
        targetAudience,
        targetTag,
        channel: ch.channel,
        templateId:
          ch.channel === "email"
            ? channels?.email?.templateId || null
            : ch.channel === "whatsapp"
              ? channels?.whatsapp?.templateId || null
              : channels?.bulkSms?.templateId || null,
        ...(templateVariables ? { templateVariables } : {}),
        ...(redirectUrl ? { redirectUrl } : {}),
        servicePackage: "full-rsvp",
      });
    }
  }

  let deleted = 0;
  if (replacePending || existingPendingCount > 0) {
    const deletionResult = await MessageSchedule.deleteMany(pendingFilter);
    deleted = deletionResult.deletedCount || 0;
  }

  if (!schedules.length) {
    return { inserted: 0, deleted, existingPendingCount, skipped: false };
  }

  await MessageSchedule.insertMany(schedules);
  return {
    inserted: schedules.length,
    deleted,
    existingPendingCount,
    skipped: false,
  };
};
