import { Request, Response } from "express";
import { MessageSchedule } from "../models/messageSchedule";

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

const normalizeAttachment = (attachment: any) => {
  if (!attachment || typeof attachment !== "object") return null;
  const url = typeof attachment.url === "string" ? attachment.url.trim() : "";
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

export const listSchedules = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const schedules = await MessageSchedule.find({ eventId }).sort({
      scheduledDate: 1,
    });
    return res.json({ schedules });
  } catch (error: any) {
    console.error("listSchedules error", error);
    return res.status(500).json({ message: "Failed to load schedules" });
  }
};

export const createSchedule = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const {
      messageType = "custom",
      messageName,
      messageTitle,
      messageBody,
      scheduledDate,
      targetAudience = "all",
      targetTag,
      channel = "email",
      templateId,
      templateVariables,
      attachment,
    } = req.body || {};

    if (!scheduledDate) {
      return res.status(400).json({ message: "scheduledDate is required" });
    }
    const normalizedBody =
      typeof messageBody === "string" ? messageBody.trim() : "";
    if (messageType === "custom" && !normalizedBody) {
      return res.status(400).json({
        message: "messageBody is required for custom schedules",
      });
    }

    const normalizedAudience = normalizeTargetAudience(targetAudience);
    const normalizedTemplateVariables =
      channel === "whatsapp" ? normalizeTemplateVariables(templateVariables) : null;
    const schedule = await MessageSchedule.create({
      eventId,
      messageType,
      messageName,
      messageTitle,
      messageBody: normalizedBody || null,
      attachment: normalizeAttachment(attachment),
      scheduledDate: new Date(scheduledDate),
      targetAudience: normalizedAudience,
      targetTag:
        normalizedAudience === "tag" ? normalizeTargetTag(targetTag) : null,
      channel,
      templateId: templateId || null,
      ...(normalizedTemplateVariables ? { templateVariables: normalizedTemplateVariables } : {}),
      status: "pending",
    });

    return res.status(201).json({ message: "Schedule created", schedule });
  } catch (error: any) {
    console.error("createSchedule error", error);
    return res.status(500).json({ message: "Failed to create schedule" });
  }
};

export const updateSchedule = async (req: Request, res: Response) => {
  try {
    const { scheduleId } = req.params;
    const {
      status,
      scheduledDate,
      messageName,
      messageTitle,
      messageBody,
      templateVariables,
      attachment,
      targetAudience,
      targetTag,
    } = req.body || {};

    const update: any = {};
    if (status) update.status = status;
    if (scheduledDate) update.scheduledDate = new Date(scheduledDate);
    if (messageName !== undefined) update.messageName = messageName;
    if (messageTitle !== undefined) update.messageTitle = messageTitle;
    if (messageBody !== undefined) {
      const normalizedBody =
        typeof messageBody === "string" ? messageBody.trim() : "";
      if (!normalizedBody) {
        return res.status(400).json({
          message: "messageBody cannot be empty",
        });
      }
      update.messageBody = normalizedBody;
    }
    if (attachment !== undefined) {
      update.attachment = normalizeAttachment(attachment);
    }
    if (templateVariables !== undefined) {
      const schedule = await MessageSchedule.findById(scheduleId).select({ channel: 1 }).lean();
      if (schedule?.channel === "whatsapp") {
        update.templateVariables = normalizeTemplateVariables(templateVariables);
      }
    }
    if (targetAudience !== undefined) {
      const normalizedAudience = normalizeTargetAudience(targetAudience);
      update.targetAudience = normalizedAudience;
      update.targetTag =
        normalizedAudience === "tag" ? normalizeTargetTag(targetTag) : null;
    } else if (targetTag !== undefined) {
      update.targetTag = normalizeTargetTag(targetTag);
    }

    const schedule = await MessageSchedule.findByIdAndUpdate(
      scheduleId,
      update,
      { new: true },
    );
    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    return res.json({ message: "Schedule updated", schedule });
  } catch (error: any) {
    console.error("updateSchedule error", error);
    return res.status(500).json({ message: "Failed to update schedule" });
  }
};

export const deleteSchedule = async (req: Request, res: Response) => {
  try {
    const { scheduleId } = req.params;
    const schedule = await MessageSchedule.findByIdAndDelete(scheduleId);
    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }
    return res.json({ message: "Schedule deleted" });
  } catch (error: any) {
    console.error("deleteSchedule error", error);
    return res.status(500).json({ message: "Failed to delete schedule" });
  }
};
