import { Request, Response } from "express";
import { MessageSchedule } from "../models/messageSchedule";

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
      channel = "email",
      templateId,
      attachment,
    } = req.body || {};

    if (!scheduledDate) {
      return res.status(400).json({ message: "scheduledDate is required" });
    }

    const schedule = await MessageSchedule.create({
      eventId,
      messageType,
      messageName,
      messageTitle,
      messageBody,
      attachment: normalizeAttachment(attachment),
      scheduledDate: new Date(scheduledDate),
      targetAudience,
      channel,
      templateId: templateId || null,
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
      attachment,
    } = req.body || {};

    const update: any = {};
    if (status) update.status = status;
    if (scheduledDate) update.scheduledDate = new Date(scheduledDate);
    if (messageName !== undefined) update.messageName = messageName;
    if (messageTitle !== undefined) update.messageTitle = messageTitle;
    if (messageBody !== undefined) update.messageBody = messageBody;
    if (attachment !== undefined) {
      update.attachment = normalizeAttachment(attachment);
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
