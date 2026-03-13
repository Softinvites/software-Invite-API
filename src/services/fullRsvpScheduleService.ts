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
    value === "pending-and-no"
  ) {
    return value;
  }
  return "all";
};

const buildDefaultFullSequence = (baseDate: Date) => [
  {
    scheduledDate: new Date(baseDate.getTime() + 1 * DAY_MS),
    messageName: "Initial Invitation",
    messageTitle: "Initial Invitation",
    messageBody: "",
    channels: { email: { enabled: true } },
  },
  {
    scheduledDate: new Date(baseDate.getTime() + 4 * DAY_MS),
    messageName: "Event Details",
    messageTitle: "Event Details",
    messageBody: "",
    channels: { email: { enabled: true } },
  },
  {
    scheduledDate: new Date(baseDate.getTime() + 7 * DAY_MS),
    messageName: "Reminder",
    messageTitle: "Reminder",
    messageBody: "",
    channels: { email: { enabled: true } },
  },
  {
    scheduledDate: new Date(baseDate.getTime() + 14 * DAY_MS),
    messageName: "Follow Up",
    messageTitle: "Follow Up",
    messageBody: "",
    channels: { email: { enabled: true } },
  },
  {
    scheduledDate: new Date(baseDate.getTime() + 21 * DAY_MS),
    messageName: "Last Call",
    messageTitle: "Last Call",
    messageBody: "",
    channels: { email: { enabled: true } },
  },
  {
    scheduledDate: new Date(baseDate.getTime() + 28 * DAY_MS),
    messageName: "Final Logistics",
    messageTitle: "Final Logistics",
    messageBody: "",
    channels: { email: { enabled: true } },
  },
  {
    scheduledDate: new Date(baseDate.getTime() + 31 * DAY_MS),
    messageName: "Post Event Thanks",
    messageTitle: "Post Event Thanks",
    messageBody: "",
    channels: { email: { enabled: true } },
  },
];

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
  const sequence =
    Array.isArray(event.customMessageSequence) && event.customMessageSequence.length
      ? event.customMessageSequence
      : buildDefaultFullSequence(now);
  const schedules: any[] = [];

  for (const item of sequence) {
    const scheduledDate = normalizeSequenceDate(item, now);
    if (!scheduledDate) continue;

    const messageTitle = String(
      item?.messageTitle || item?.messageName || "Custom Message",
    ).trim();
    const messageBody =
      typeof item?.messageBody === "string" && item.messageBody.trim()
        ? item.messageBody
        : (event as any).rsvpMessage ||
          event.description ||
          "You're invited! Please let us know if you will attend.";
    const messageName = String(item?.messageName || messageTitle || "Custom Message").trim();
    const attachment = normalizeSequenceAttachment(item?.attachment);
    const channels = item.channels || { email: { enabled: true } };
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
      schedules.push({
        eventId: event._id,
        messageType: "custom",
        messageName: messageName || "Custom Message",
        messageTitle: messageTitle || "Custom Message",
        messageBody,
        includeResponseButtons: item?.includeResponseButtons !== false,
        attachment,
        scheduledDate,
        status: "pending",
        targetAudience: normalizeTargetAudience(item?.conditions?.audienceType),
        channel: ch.channel,
        templateId:
          ch.channel === "email"
            ? channels?.email?.templateId || null
            : ch.channel === "whatsapp"
              ? channels?.whatsapp?.templateId || null
              : channels?.bulkSms?.templateId || null,
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
