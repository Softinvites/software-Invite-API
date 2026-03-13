import { Request, Response } from "express";
import { Event } from "../models/eventmodel";
import { createEventSchema, updateEventSchema, option } from "../utils/utils";
import { sendEmail } from "../library/helpers/emailService";
import { deleteFromS3, uploadToS3 } from "../utils/s3Utils";
import { syncFullRsvpPendingSchedules } from "../services/fullRsvpScheduleService";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

const parseMaybeJson = (value: any) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const normalizeRsvpServicePackage = (value: any) =>
  value === "invitation-only" ? "invitation-only" : "full-rsvp";

const STEP_ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "application/pdf",
]);

const sanitizeFileName = (name: string) =>
  String(name || "attachment")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);

const getUploadedFiles = (req: Request): Express.Multer.File[] => {
  const files = (req as any).files;
  if (Array.isArray(files)) {
    return files as Express.Multer.File[];
  }
  const singleFile = (req as any).file as Express.Multer.File | undefined;
  return singleFile ? [singleFile] : [];
};

const getUploadedFileByField = (
  files: Express.Multer.File[],
  fieldName: string,
) => files.find((f) => f.fieldname === fieldName);

const normalizeAttachmentObject = (input: any) => {
  if (!input || typeof input !== "object") return null;
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) return null;
  return {
    url,
    filename:
      typeof input.filename === "string" && input.filename.trim()
        ? input.filename.trim()
        : null,
    contentType:
      typeof input.contentType === "string" && input.contentType.trim()
        ? input.contentType.trim()
        : null,
  };
};

const normalizeMessageAudience = (value: any) => {
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

const resolveCustomMessageSequence = async (
  customMessageSequence: any,
  files: Express.Multer.File[],
  eventRef: string,
) => {
  const parsed = parseMaybeJson(customMessageSequence);
  if (!Array.isArray(parsed)) {
    return parsed;
  }

  const fileMap = new Map<string, Express.Multer.File>();
  files.forEach((file) => {
    fileMap.set(file.fieldname, file);
  });

  const safeEventRef = String(eventRef || "event").replace(/[^a-zA-Z0-9-_]/g, "_");
  const nextSequence: any[] = [];

  for (const rawStep of parsed) {
    const step = rawStep && typeof rawStep === "object" ? { ...rawStep } : {};
    const rawAttachment =
      step.attachment && typeof step.attachment === "object"
        ? { ...step.attachment }
        : null;

    const uploadKey =
      rawAttachment && typeof rawAttachment.uploadKey === "string"
        ? rawAttachment.uploadKey.trim()
        : "";
    const uploadedFile = uploadKey ? fileMap.get(uploadKey) : null;

    let attachment = normalizeAttachmentObject(rawAttachment);

    if (uploadedFile) {
      if (!STEP_ATTACHMENT_MIME_TYPES.has(uploadedFile.mimetype)) {
        throw new Error("Attachment must be PNG, JPG, or PDF");
      }
      const safeFile = sanitizeFileName(uploadedFile.originalname);
      const key = `events/${safeEventRef}/rsvp-step-attachments/${Date.now()}_${safeFile}`;
      const url = await uploadToS3(
        uploadedFile.buffer,
        key,
        uploadedFile.mimetype,
      );
      attachment = {
        url,
        filename: uploadedFile.originalname || safeFile,
        contentType: uploadedFile.mimetype,
      };
    }

    step.attachment = attachment;
    step.conditions = {
      ...(step.conditions && typeof step.conditions === "object" ? step.conditions : {}),
      audienceType: normalizeMessageAudience(step?.conditions?.audienceType),
    };
    nextSequence.push(step);
  }

  return nextSequence;
};

export const createEvent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Log environment configuration
    console.log("Environment check:", {
      NODE_ENV: process.env.NODE_ENV,
      EMAIL_LAMBDA_FUNCTION_NAME: process.env.EMAIL_LAMBDA_FUNCTION_NAME,
      EMAIL_FROM: process.env.EMAIL_FROM,
      AWS_REGION: process.env.AWS_REGION,
    });

    const {
      name,
      date,
      location,
      description,
      rsvpMessage,
      rsvpBgColor,
      rsvpAccentColor,
      servicePackage,
      messageCycle,
      channelConfig,
      customMessageSequence,
      rsvpDeadline,
      eventEndDate,
    } = req.body;
    const normalizedServicePackage = normalizeRsvpServicePackage(servicePackage);

    // ✅ Validate event fields
    const validateEvent = createEventSchema.validate(
      {
        name,
        date,
        location,
        description,
        rsvpMessage,
        rsvpBgColor,
        rsvpAccentColor,
        servicePackage: normalizedServicePackage,
        messageCycle,
        channelConfig,
        customMessageSequence,
        rsvpDeadline,
        eventEndDate,
      },
      option
    );
    if (validateEvent.error) {
      res.status(400).json({ error: validateEvent.error.details[0].message });
      return;
    }

    const uploadedFiles = getUploadedFiles(req);
    const ivFile = getUploadedFileByField(uploadedFiles, "iv");
    let ivImageUrl: string | null = null;
    const resolvedCustomMessageSequence =
      customMessageSequence !== undefined
        ? await resolveCustomMessageSequence(
            customMessageSequence,
            uploadedFiles,
            name || "event",
          )
        : undefined;

    // ✅ Upload IV image if provided
    if (ivFile) {
      try {
        const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
        ivImageUrl = await uploadToS3(
          ivFile.buffer,
          `events/${safeName}_iv_${Date.now()}.png`,
          ivFile.mimetype
        );
        console.log("✅ Image uploaded successfully:", ivImageUrl);
      } catch (uploadError) {
        console.error("❌ Image upload failed:", uploadError);
        // Continue without image if upload fails
      }
    }

    // ✅ Create event in DB
    const newEvent = await Event.create({
      name,
      date,
      location,
      description,
      iv: ivImageUrl,
      ...(rsvpMessage !== undefined ? { rsvpMessage } : {}),
      ...(rsvpBgColor !== undefined ? { rsvpBgColor } : {}),
      ...(rsvpAccentColor !== undefined ? { rsvpAccentColor } : {}),
      servicePackage: normalizedServicePackage,
      ...(messageCycle !== undefined ? { messageCycle } : {}),
      ...(channelConfig !== undefined
        ? { channelConfig: parseMaybeJson(channelConfig) }
        : {}),
      ...(customMessageSequence !== undefined
        ? { customMessageSequence: resolvedCustomMessageSequence }
        : {}),
      ...(rsvpDeadline !== undefined
        ? { rsvpDeadline: new Date(rsvpDeadline) }
        : {}),
      ...(eventEndDate !== undefined
        ? { eventEndDate: new Date(eventEndDate) }
        : {}),
    });

    console.log("✅ Event created successfully:", newEvent.id);

    let scheduleSync: any = null;
    if (newEvent.servicePackage !== "invitation-only" && customMessageSequence !== undefined) {
      try {
        scheduleSync = await syncFullRsvpPendingSchedules(newEvent, {
          replacePending: true,
        });
      } catch (scheduleError) {
        console.error("Failed to sync full RSVP schedules after create:", scheduleError);
      }
    }

    // ✅ Respond immediately so frontend doesn't break
    res.status(201).json({
      message: "Event created successfully",
      event: newEvent,
      ...(scheduleSync ? { scheduleSync } : {}),
    });

    // ✅ Send admin notification email with better error handling
    const adminEmail = process.env.ADMIN_EMAIL || "softinvites@gmail.com";
    const emailContent = `
      <h2>🎉 New Event Created</h2>
      <p>Dear Admin,</p>
      <p>A new event has been created on your platform:</p>
      <ul>
        <li><strong>Name:</strong> ${name}</li>
        <li><strong>Date:</strong> ${date}</li>
        <li><strong>Location:</strong> ${location}</li>
      </ul>
      <p>Log in to view more details.</p>
    `;

    try {
      console.log("📧 Attempting to send admin notification email...");
      await sendEmail(adminEmail, `New Event Created: ${name}`, emailContent);
      console.log("✅ Admin notification email sent successfully");
    } catch (emailError) {
      console.error("❌ Failed to send admin notification:", emailError);

      // Implement retry logic
      try {
        console.log("🔄 Retrying email send...");
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
        await sendEmail(adminEmail, `New Event Created: ${name}`, emailContent);
        console.log("✅ Admin notification email sent successfully on retry");
      } catch (retryError) {
        console.error("❌ Email retry failed:", retryError);
        // Consider implementing a queue system or notification for failed emails
      }
    }
  } catch (error: any) {
    console.error("❌ Error creating event:", {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });

    res.status(500).json({
      message: "Error creating event",
      error: error.message || "Unknown error",
    });
  }
};

export const updateEvent = async (req: Request, res: Response) => {
  try {
    const {
      id,
      name,
      date,
      location,
      description,
      rsvpMessage,
      rsvpBgColor,
      rsvpAccentColor,
      servicePackage,
      messageCycle,
      channelConfig,
      customMessageSequence,
      rsvpDeadline,
      eventEndDate,
    } = req.body;

    if (!id) {
      return res
        .status(400)
        .json({ message: "Event ID is required in form-data" });
    }

    // Find existing event so we can delete old IV if needed and determine safeName
    const existingEvent = await Event.findById(id);
    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    const updateData: any = {};
    const uploadedFiles = getUploadedFiles(req);
    const ivFile = getUploadedFileByField(uploadedFiles, "iv");
    if (name) updateData.name = name;
    if (date) updateData.date = date;
    if (location) updateData.location = location;
    if (description) updateData.description = description;
    if (rsvpMessage !== undefined) updateData.rsvpMessage = rsvpMessage;
    if (rsvpBgColor !== undefined) updateData.rsvpBgColor = rsvpBgColor;
    if (rsvpAccentColor !== undefined) updateData.rsvpAccentColor = rsvpAccentColor;
    if (servicePackage !== undefined) {
      updateData.servicePackage = normalizeRsvpServicePackage(servicePackage);
    }
    if (messageCycle !== undefined) updateData.messageCycle = messageCycle;
    if (channelConfig !== undefined)
      updateData.channelConfig = parseMaybeJson(channelConfig);
    if (customMessageSequence !== undefined)
      updateData.customMessageSequence = await resolveCustomMessageSequence(
        customMessageSequence,
        uploadedFiles,
        id || existingEvent._id?.toString() || existingEvent.name || "event",
      );
    if (rsvpDeadline !== undefined)
      updateData.rsvpDeadline = new Date(rsvpDeadline);
    if (eventEndDate !== undefined)
      updateData.eventEndDate = new Date(eventEndDate);

    // Handle new IV upload (if provided via multipart/form-data)
    if (ivFile?.buffer) {
      try {
        // Delete old IV from S3 if it was an S3 URL
        if (existingEvent.iv) {
          try {
            const existingKey = new URL(existingEvent.iv).pathname.slice(1);
            await deleteFromS3(existingKey);
          } catch (delErr) {
            console.warn("Could not delete previous IV from S3:", delErr);
          }
        }

        const safeName = (name || existingEvent.name || "event").replace(
          /[^a-zA-Z0-9-_]/g,
          "_"
        );
        const ivImageUrl = await uploadToS3(
          ivFile.buffer,
          `events/${safeName}_iv_${Date.now()}.png`,
          ivFile.mimetype || "image/png"
        );

        updateData.iv = ivImageUrl;
      } catch (uploadErr) {
        console.error("Error uploading new IV:", uploadErr);
        // continue without failing the whole request; we'll still update other fields
      }
    }

    const updatedEvent = await Event.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    const effectiveServicePackage =
      normalizeRsvpServicePackage(
        updateData.servicePackage ?? existingEvent.servicePackage,
      );
    const shouldSyncFullSchedules =
      effectiveServicePackage !== "invitation-only" &&
      (
        customMessageSequence !== undefined ||
        servicePackage !== undefined ||
        channelConfig !== undefined ||
        rsvpMessage !== undefined ||
        description !== undefined
      );

    let scheduleSync: any = null;
    if (shouldSyncFullSchedules) {
      scheduleSync = await syncFullRsvpPendingSchedules(updatedEvent, {
        replacePending: true,
      });
    }

    // Return updated event
    res.status(200).json({
      message: "Event updated successfully",
      event: updatedEvent,
      ...(scheduleSync ? { scheduleSync } : {}),
    });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({
      message: "Error updating event",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const getAllEvents = async (req: Request, res: Response) => {
  try {
    // Update event statuses before fetching
    const events = await Event.find({});

    // Update eventStatus for each event
    for (const event of events) {
      const currentStatus = event.getEventStatus();
      if (event.eventStatus !== currentStatus) {
        event.eventStatus = currentStatus;
        await event.save();
      }
    }

    if (events.length == 0) {
      res.status(404).json({ message: "No events found" });
      return;
    }

    res
      .status(200)
      .json({ message: "All events successfully fetched", events });
  } catch (error) {
    res.status(500).json({ message: "Error fetching events" });
  }
};

export const getEventById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    // Update event status
    const currentStatus = event.getEventStatus();
    if (event.eventStatus !== currentStatus) {
      event.eventStatus = currentStatus;
      await event.save();
    }

    res.status(200).json({ message: "Event successfully fetched", event });
  } catch (error) {
    res.status(500).json({ message: "Error fetching events" });
  }
};

export const updateRsvpSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rsvpBgColor, rsvpAccentColor } = req.body;

    if (!id) {
      return res.status(400).json({ message: "Event ID is required" });
    }

    const updateData: any = {};
    if (rsvpBgColor !== undefined) updateData.rsvpBgColor = rsvpBgColor;
    if (rsvpAccentColor !== undefined) updateData.rsvpAccentColor = rsvpAccentColor;

    const updatedEvent = await Event.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    return res.status(200).json({
      message: "RSVP settings updated",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Error updating RSVP settings:", error);
    return res.status(500).json({
      message: "Error updating RSVP settings",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const updateRsvpFormSettings = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rsvpFormSettings } = req.body;

    if (!id) {
      return res.status(400).json({ message: "Event ID is required" });
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      id,
      { rsvpFormSettings: rsvpFormSettings ?? null },
      { new: true },
    );

    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    return res.status(200).json({
      message: "RSVP form settings updated",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Error updating RSVP form settings:", error);
    return res.status(500).json({
      message: "Error updating RSVP form settings",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const deleteAllEvents = async (req: Request, res: Response) => {
  try {
    await Event.deleteMany({});
    res.status(200).json({ message: "All events deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting all events" });
  }
};

export const deleteSingleEvent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
    }

    await Event.findByIdAndDelete(id);
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting event" });
  }
};
