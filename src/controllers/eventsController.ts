import { Request, Response } from "express";
import { Event } from "../models/eventmodel";
import { createEventSchema, updateEventSchema, option } from "../utils/utils";
import { sendEmail } from "../library/helpers/emailService";
import {
  createPresignedUploadUrl,
  deleteFromS3,
  uploadToS3,
} from "../utils/s3Utils";
import { syncFullRsvpPendingSchedules } from "../services/fullRsvpScheduleService";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

import sharp from "sharp";

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

// WhatsApp card templates require JPEG for header images.
// Accept common image formats and convert to JPEG on upload.
const IV_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const STEP_ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const WHATSAPP_IMAGE_ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const EVENT_ASSET_TYPES = new Set(["iv", "sequence-attachment"]);
const BASE64_DATA_URI_PATTERN = /^data:([^;,]+);base64,([\s\S]+)$/i;
const BASE64_CONTENT_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
const HTML_TAG_PATTERN = /<[^>]+>/;

type BufferedUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

// Convert any image buffer to JPEG for WhatsApp card header compatibility.
// WhatsApp rejects PNG/WEBP headers (error 63049).
const convertToJpeg = async (buffer: Buffer): Promise<Buffer> =>
  sharp(buffer).jpeg({ quality: 90 }).toBuffer();

const sanitizeFileName = (name: string) =>
  String(name || "attachment")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);

const sanitizeEventRef = (value: any) =>
  String(value || "event")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 120) || "event";

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

const resolveIvUrlFromBody = (body: Record<string, any>): string | null => {
  const candidates = [body?.ivUrl, body?.iv];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed || !trimmed.includes("://")) continue;
    return trimmed;
  }
  return null;
};

const parseBase64Iv = (value: any): BufferedUpload | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  let mimeType = "image/png";
  let encodedPayload = trimmed;
  const dataUriMatch = trimmed.match(BASE64_DATA_URI_PATTERN);

  if (dataUriMatch) {
    mimeType = dataUriMatch[1].toLowerCase();
    encodedPayload = dataUriMatch[2];
  } else {
    if (trimmed.includes("://") || trimmed.length < 128) {
      return null;
    }
  }

  if (!IV_MIME_TYPES.has(mimeType)) {
    throw new Error("Only PNG, JPEG, or WEBP images are allowed for the invitation image");
  }

  const normalizedPayload = encodedPayload.replace(/\s+/g, "");
  if (
    !normalizedPayload ||
    !BASE64_CONTENT_PATTERN.test(normalizedPayload) ||
    normalizedPayload.length % 4 !== 0
  ) {
    throw new Error(
      "Invalid base64 IV image. Send a PNG file via multipart/form-data or provide a valid base64 PNG payload.",
    );
  }

  const buffer = Buffer.from(normalizedPayload, "base64");
  if (!buffer.length) {
    throw new Error(
      "Invalid base64 IV image. Send a PNG file via multipart/form-data or provide a valid base64 PNG payload.",
    );
  }

  return {
    buffer,
    mimetype: mimeType,
    originalname: "iv.png",
  };
};

const resolveIvUpload = (
  req: Request,
  files: Express.Multer.File[],
): BufferedUpload | null => {
  const uploadedFile = getUploadedFileByField(files, "iv");
  if (uploadedFile?.buffer) {
    return {
      buffer: uploadedFile.buffer,
      mimetype: uploadedFile.mimetype || "image/png",
      originalname: uploadedFile.originalname || "iv.png",
    };
  }

  return parseBase64Iv((req.body as Record<string, any>)?.iv);
};

const classifyEventRequestError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === "Only PNG is allowed for IV image" ||
    error.message === "Only PNG, JPEG, or WEBP images are allowed for the invitation image"
  ) {
    return {
      status: 400,
      message: error.message,
      code: "INVALID_IV_IMAGE",
    };
  }

  if (
    error.message ===
    "Attachment must be image (PNG, JPG, JPEG, WEBP, GIF) or PDF"
  ) {
    return {
      status: 400,
      message: error.message,
      code: "INVALID_ATTACHMENT",
    };
  }

  if (
    error.message ===
    "WhatsApp message body must be plain text without HTML tags"
  ) {
    return {
      status: 400,
      message: error.message,
      code: "INVALID_WHATSAPP_MESSAGE_BODY",
    };
  }

  if (
    error.message ===
    "WhatsApp-enabled steps only support image attachments (PNG/JPG/JPEG/WEBP/GIF)"
  ) {
    return {
      status: 400,
      message: error.message,
      code: "INVALID_WHATSAPP_ATTACHMENT",
    };
  }

  if (error.message.startsWith("Invalid base64 IV image")) {
    return {
      status: 400,
      message: error.message,
      code: "INVALID_IV_IMAGE",
    };
  }
  return null;
};

export const createEventAssetUpload = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { assetType, fileName, contentType, eventRef } = req.body || {};

    if (
      typeof assetType !== "string" ||
      !EVENT_ASSET_TYPES.has(assetType) ||
      typeof fileName !== "string" ||
      !fileName.trim() ||
      typeof contentType !== "string" ||
      !contentType.trim()
    ) {
      res.status(400).json({
        message: "assetType, fileName, and contentType are required",
      });
      return;
    }

    if (assetType === "iv" && !IV_MIME_TYPES.has(contentType)) {
      res.status(400).json({ message: "Only PNG, JPEG, or WEBP images are allowed for the invitation image" });
      return;
    }

    if (
      assetType === "sequence-attachment" &&
      !STEP_ATTACHMENT_MIME_TYPES.has(contentType)
    ) {
      res.status(400).json({
        message:
          "Step attachment must be image (PNG, JPG, JPEG, WEBP, GIF) or PDF",
      });
      return;
    }

    const safeEventRef = sanitizeEventRef(eventRef);
    const safeFileName = sanitizeFileName(fileName);
    const prefix =
      assetType === "iv"
        ? `invitations/${safeEventRef}`
        : `events/${safeEventRef}/rsvp-step-attachments`;
    const key = `${prefix}/${Date.now()}_${safeFileName}`;
    const signedUpload = await createPresignedUploadUrl(key, contentType);

    res.status(200).json({
      message: "Upload URL created successfully",
      ...signedUpload,
      assetType,
      contentType,
      expiresIn: 900,
    });
  } catch (error: any) {
    console.error("Error creating event asset upload URL:", error);
    res.status(500).json({
      message: "Failed to create upload URL",
      error: error?.message || "Unknown error",
    });
  }
};

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

const normalizeTemplateVariables = (
  value: any,
): Record<string, string> | null => {
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

const hasImageFileExtension = (value?: string | null) =>
  /\.(png|jpe?g|webp|gif)([?#].*)?$/i.test(String(value || "").trim());

const isWhatsAppCompatibleAttachment = (attachment: any) => {
  if (!attachment || typeof attachment !== "object") return true;

  const contentType = String(attachment.contentType || "")
    .trim()
    .toLowerCase();
  if (contentType) {
    return WHATSAPP_IMAGE_ATTACHMENT_MIME_TYPES.has(contentType);
  }

  return (
    hasImageFileExtension(attachment.url) ||
    hasImageFileExtension(attachment.filename)
  );
};

const validateWhatsAppSequenceStep = (step: any, attachment: any) => {
  const whatsappEnabled = Boolean(step?.channels?.whatsapp?.enabled);
  if (!whatsappEnabled) return;

  const messageBody =
    typeof step?.messageBody === "string" ? step.messageBody : "";
  if (HTML_TAG_PATTERN.test(messageBody)) {
    throw new Error(
      "WhatsApp message body must be plain text without HTML tags",
    );
  }

  if (attachment && !isWhatsAppCompatibleAttachment(attachment)) {
    throw new Error(
      "WhatsApp-enabled steps only support image attachments (PNG/JPG/JPEG/WEBP/GIF)",
    );
  }
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
    value === "pending-and-no" ||
    value === "tag"
  ) {
    return value;
  }
  return "all";
};

const normalizeMessageTargetTag = (value: any) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  return trimmed || null;
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

  const safeEventRef = String(eventRef || "event").replace(
    /[^a-zA-Z0-9-_]/g,
    "_",
  );
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
        throw new Error(
          "Attachment must be image (PNG, JPG, JPEG, WEBP, GIF) or PDF",
        );
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

    const audienceType = normalizeMessageAudience(
      step?.conditions?.audienceType,
    );
    const targetTag =
      audienceType === "tag"
        ? normalizeMessageTargetTag(step?.conditions?.targetTag)
        : null;

    step.attachment = attachment;
    step.conditions = {
      ...(step.conditions && typeof step.conditions === "object"
        ? step.conditions
        : {}),
      audienceType,
      targetTag,
    };
    if (
      step?.channels?.whatsapp &&
      typeof step.channels.whatsapp === "object"
    ) {
      const normalizedTemplateVariables = normalizeTemplateVariables(
        (step.channels.whatsapp as any).templateVariables,
      );
      if (normalizedTemplateVariables) {
        (step.channels.whatsapp as any).templateVariables =
          normalizedTemplateVariables;
      } else {
        delete (step.channels.whatsapp as any).templateVariables;
      }
    }
    validateWhatsAppSequenceStep(step, attachment);
    nextSequence.push(step);
  }

  return nextSequence;
};

// Multipart form fields arrive as strings ("true"/"false").
const parseBooleanField = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "on") return true;
  if (v === "false" || v === "0" || v === "off") return false;
  return undefined;
};

export const createEvent = async (
  req: Request,
  res: Response,
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
      ivUrl,
      rsvpMessage,
      rsvpBgColor,
      rsvpAccentColor,
      servicePackage,
      messageCycle,
      channelConfig,
      customMessageSequence,
      rsvpDeadline,
      eventEndDate,
      emailSenderMode,
      emailSenderName,
      smsFallbackEnabled,
    } = req.body;
    const normalizedServicePackage =
      normalizeRsvpServicePackage(servicePackage);

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
      option,
    );
    if (validateEvent.error) {
      res.status(400).json({ error: validateEvent.error.details[0].message });
      return;
    }

    const uploadedFiles = getUploadedFiles(req);
    const ivUpload = resolveIvUpload(req, uploadedFiles);
    let ivImageUrl: string | null = resolveIvUrlFromBody(req.body) || null;
    const resolvedCustomMessageSequence =
      customMessageSequence !== undefined
        ? await resolveCustomMessageSequence(
            customMessageSequence,
            uploadedFiles,
            name || "event",
          )
        : undefined;

    // ✅ Create event in DB first to get _id
    const newEvent = await Event.create({
      name,
      date,
      location,
      description,
      iv: ivImageUrl, // will set/overwrite after upload if iv file included
      ...(rsvpMessage !== undefined ? { rsvpMessage } : {}),
      ...(rsvpBgColor !== undefined ? { rsvpBgColor } : {}),
      ...(rsvpAccentColor !== undefined ? { rsvpAccentColor } : {}),
      ...normalizeEmailSender(emailSenderMode, emailSenderName),
      ...(parseBooleanField(smsFallbackEnabled) !== undefined
        ? { smsFallbackEnabled: parseBooleanField(smsFallbackEnabled) }
        : {}),
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

    // ✅ Upload IV image if provided — always convert to JPEG for WhatsApp card header compatibility
    if (ivUpload) {
      try {
        const jpegBuffer = await convertToJpeg(ivUpload.buffer);
        const filename = `${newEvent._id}.jpg`;
        ivImageUrl = await uploadToS3(
          jpegBuffer,
          `invitations/${newEvent._id}/${filename}`,
          "image/jpeg",
        );
        // Update event with iv
        await Event.findByIdAndUpdate(newEvent._id, { iv: ivImageUrl });
        (newEvent as any).iv = ivImageUrl;
        console.log("✅ Image uploaded successfully:", ivImageUrl);
      } catch (uploadError) {
        console.error("❌ Image upload failed:", uploadError);
        // Continue without image if upload fails
      }
    }

    console.log("✅ Event created successfully:", newEvent.id);

    let scheduleSync: any = null;
    if (
      newEvent.servicePackage !== "invitation-only" &&
      customMessageSequence !== undefined
    ) {
      try {
        scheduleSync = await syncFullRsvpPendingSchedules(newEvent, {
          replacePending: true,
        });
      } catch (scheduleError) {
        console.error(
          "Failed to sync full RSVP schedules after create:",
          scheduleError,
        );
      }
    }

    // ✅ Respond immediately so frontend doesn't break
    res.status(201).json({
      message: "Event created successfully",
      event: {
        ...(typeof (newEvent as any).toObject === "function"
          ? (newEvent as any).toObject()
          : newEvent),
        iv: ivImageUrl,
      },
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
    const requestError = classifyEventRequestError(error);
    if (requestError) {
      res.status(requestError.status).json({
        message: requestError.message,
        code: requestError.code,
      });
      return;
    }

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

// Guest emails show "SoftInvites", the event title, or custom text as the
// sender name. Unknown modes, and custom with no text, fall back to SoftInvites.
const normalizeEmailSender = (mode: unknown, name: unknown) => {
  const cleanName = String(name ?? "").trim().slice(0, 70);
  const cleanMode =
    mode === "event" || (mode === "custom" && cleanName) ? String(mode) : "softinvites";
  return { emailSenderMode: cleanMode, emailSenderName: cleanName };
};

export const updateEvent = async (req: Request, res: Response) => {
  try {
    const {
      id,
      name,
      date,
      location,
      description,
      ivUrl,
      rsvpMessage,
      rsvpBgColor,
      rsvpAccentColor,
      servicePackage,
      messageCycle,
      channelConfig,
      customMessageSequence,
      rsvpDeadline,
      eventEndDate,
      emailSenderMode,
      emailSenderName,
      smsFallbackEnabled,
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
    const ivUpload = resolveIvUpload(req, uploadedFiles);
    const resolvedIvUrl = resolveIvUrlFromBody(req.body);
    if (name) updateData.name = name;
    if (date) updateData.date = date;
    if (location) updateData.location = location;
    if (description) updateData.description = description;
    if (rsvpMessage !== undefined) updateData.rsvpMessage = rsvpMessage;
    if (rsvpBgColor !== undefined) updateData.rsvpBgColor = rsvpBgColor;
    if (rsvpAccentColor !== undefined)
      updateData.rsvpAccentColor = rsvpAccentColor;
    if (servicePackage !== undefined) {
      updateData.servicePackage = normalizeRsvpServicePackage(servicePackage);
    }
    if (emailSenderMode !== undefined || emailSenderName !== undefined) {
      Object.assign(
        updateData,
        normalizeEmailSender(
          emailSenderMode ?? existingEvent.emailSenderMode,
          emailSenderName ?? existingEvent.emailSenderName,
        ),
      );
    }
    if (parseBooleanField(smsFallbackEnabled) !== undefined) {
      updateData.smsFallbackEnabled = parseBooleanField(smsFallbackEnabled);
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
    if (resolvedIvUrl) updateData.iv = resolvedIvUrl;

    // Handle new IV upload — always convert to JPEG for WhatsApp card header compatibility
    if (ivUpload?.buffer) {
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

        const jpegBuffer = await convertToJpeg(ivUpload.buffer);
        const filename = `${id}.jpg`;
        const ivImageUrl = await uploadToS3(
          jpegBuffer,
          `invitations/${id}/${filename}`,
          "image/jpeg",
        );

        updateData.iv = ivImageUrl;
      } catch (uploadErr) {
        console.error("Error uploading new IV:", uploadErr);
      }
    }

    const updatedEvent = await Event.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    const effectiveServicePackage = normalizeRsvpServicePackage(
      updateData.servicePackage ?? existingEvent.servicePackage,
    );
    const hasSavedSequenceBodies = Array.isArray(
      (updatedEvent as any).customMessageSequence,
    )
      ? (updatedEvent as any).customMessageSequence.some(
          (step: any) =>
            typeof step?.messageBody === "string" &&
            step.messageBody.trim().length > 0,
        )
      : false;
    // The edit dialog always sends servicePackage and channelConfig, so only
    // re-sync when the message plan really changed; editing a name, date or
    // sender must not queue (or resend) any guest messages.
    const channelEnabled = (cfg: any, ch: string) =>
      !!(cfg && typeof cfg === "object" ? cfg?.[ch]?.enabled : false);
    const prevChannelConfig = (existingEvent as any).channelConfig || {};
    const nextChannelConfig = (updatedEvent as any).channelConfig || {};
    const servicePackageChanged =
      servicePackage !== undefined &&
      normalizeRsvpServicePackage(existingEvent.servicePackage) !==
        effectiveServicePackage;
    const channelsChanged =
      channelConfig !== undefined &&
      ["email", "whatsapp", "bulkSms"].some(
        (ch) =>
          channelEnabled(prevChannelConfig, ch) !==
          channelEnabled(nextChannelConfig, ch),
      );
    const shouldSyncFullSchedules =
      effectiveServicePackage !== "invitation-only" &&
      hasSavedSequenceBodies &&
      (customMessageSequence !== undefined ||
        servicePackageChanged ||
        channelsChanged);

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
    const requestError = classifyEventRequestError(error);
    if (requestError) {
      res.status(requestError.status).json({
        message: requestError.message,
        code: requestError.code,
      });
      return;
    }

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
    if (rsvpAccentColor !== undefined)
      updateData.rsvpAccentColor = rsvpAccentColor;

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

export const saveEventIvUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, ivUrl } = req.body;
    if (!id || typeof ivUrl !== 'string' || !ivUrl.trim().includes('://')) {
      res.status(400).json({ message: 'id and a valid ivUrl are required' });
      return;
    }
    const updated = await Event.findByIdAndUpdate(
      id,
      { iv: ivUrl.trim() },
      { new: true },
    );
    if (!updated) {
      res.status(404).json({ message: 'Event not found' });
      return;
    }
    res.status(200).json({ message: 'Event invitation image URL saved', iv: updated.iv });
  } catch (error: any) {
    console.error('Error saving event iv URL:', error);
    res.status(500).json({ message: 'Failed to save event iv URL', error: error?.message });
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
