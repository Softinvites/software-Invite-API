"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSingleEvent = exports.deleteAllEvents = exports.updateRsvpFormSettings = exports.updateRsvpSettings = exports.getEventById = exports.getAllEvents = exports.updateEvent = exports.createEvent = void 0;
const eventmodel_1 = require("../models/eventmodel");
const utils_1 = require("../utils/utils");
const emailService_1 = require("../library/helpers/emailService");
const s3Utils_1 = require("../utils/s3Utils");
const fullRsvpScheduleService_1 = require("../services/fullRsvpScheduleService");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION });
const parseMaybeJson = (value) => {
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        }
        catch {
            return value;
        }
    }
    return value;
};
const normalizeRsvpServicePackage = (value) => value === "invitation-only" ? "invitation-only" : "full-rsvp";
const STEP_ATTACHMENT_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "application/pdf",
]);
const sanitizeFileName = (name) => String(name || "attachment")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
const getUploadedFiles = (req) => {
    const files = req.files;
    if (Array.isArray(files)) {
        return files;
    }
    const singleFile = req.file;
    return singleFile ? [singleFile] : [];
};
const getUploadedFileByField = (files, fieldName) => files.find((f) => f.fieldname === fieldName);
const normalizeAttachmentObject = (input) => {
    if (!input || typeof input !== "object")
        return null;
    const url = typeof input.url === "string" ? input.url.trim() : "";
    if (!url)
        return null;
    return {
        url,
        filename: typeof input.filename === "string" && input.filename.trim()
            ? input.filename.trim()
            : null,
        contentType: typeof input.contentType === "string" && input.contentType.trim()
            ? input.contentType.trim()
            : null,
    };
};
const normalizeMessageAudience = (value) => {
    if (value === "non-responders")
        return "pending";
    if (value === "pending-no" || value === "pending_and_no") {
        return "pending-and-no";
    }
    if (value === "all" ||
        value === "responders" ||
        value === "yes" ||
        value === "no" ||
        value === "pending" ||
        value === "pending-and-no") {
        return value;
    }
    return "all";
};
const resolveCustomMessageSequence = async (customMessageSequence, files, eventRef) => {
    const parsed = parseMaybeJson(customMessageSequence);
    if (!Array.isArray(parsed)) {
        return parsed;
    }
    const fileMap = new Map();
    files.forEach((file) => {
        fileMap.set(file.fieldname, file);
    });
    const safeEventRef = String(eventRef || "event").replace(/[^a-zA-Z0-9-_]/g, "_");
    const nextSequence = [];
    for (const rawStep of parsed) {
        const step = rawStep && typeof rawStep === "object" ? { ...rawStep } : {};
        const rawAttachment = step.attachment && typeof step.attachment === "object"
            ? { ...step.attachment }
            : null;
        const uploadKey = rawAttachment && typeof rawAttachment.uploadKey === "string"
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
            const url = await (0, s3Utils_1.uploadToS3)(uploadedFile.buffer, key, uploadedFile.mimetype);
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
const createEvent = async (req, res) => {
    try {
        // Log environment configuration
        console.log("Environment check:", {
            NODE_ENV: process.env.NODE_ENV,
            EMAIL_LAMBDA_FUNCTION_NAME: process.env.EMAIL_LAMBDA_FUNCTION_NAME,
            EMAIL_FROM: process.env.EMAIL_FROM,
            AWS_REGION: process.env.AWS_REGION,
        });
        const { name, date, location, description, rsvpMessage, rsvpBgColor, rsvpAccentColor, servicePackage, messageCycle, channelConfig, customMessageSequence, rsvpDeadline, eventEndDate, } = req.body;
        const normalizedServicePackage = normalizeRsvpServicePackage(servicePackage);
        // ✅ Validate event fields
        const validateEvent = utils_1.createEventSchema.validate({
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
        }, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ error: validateEvent.error.details[0].message });
            return;
        }
        const uploadedFiles = getUploadedFiles(req);
        const ivFile = getUploadedFileByField(uploadedFiles, "iv");
        let ivImageUrl = null;
        const resolvedCustomMessageSequence = customMessageSequence !== undefined
            ? await resolveCustomMessageSequence(customMessageSequence, uploadedFiles, name || "event")
            : undefined;
        // ✅ Upload IV image if provided
        if (ivFile) {
            try {
                const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
                ivImageUrl = await (0, s3Utils_1.uploadToS3)(ivFile.buffer, `events/${safeName}_iv_${Date.now()}.png`, ivFile.mimetype);
                console.log("✅ Image uploaded successfully:", ivImageUrl);
            }
            catch (uploadError) {
                console.error("❌ Image upload failed:", uploadError);
                // Continue without image if upload fails
            }
        }
        // ✅ Create event in DB
        const newEvent = await eventmodel_1.Event.create({
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
        let scheduleSync = null;
        if (newEvent.servicePackage !== "invitation-only" && customMessageSequence !== undefined) {
            try {
                scheduleSync = await (0, fullRsvpScheduleService_1.syncFullRsvpPendingSchedules)(newEvent, {
                    replacePending: true,
                });
            }
            catch (scheduleError) {
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
            await (0, emailService_1.sendEmail)(adminEmail, `New Event Created: ${name}`, emailContent);
            console.log("✅ Admin notification email sent successfully");
        }
        catch (emailError) {
            console.error("❌ Failed to send admin notification:", emailError);
            // Implement retry logic
            try {
                console.log("🔄 Retrying email send...");
                await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
                await (0, emailService_1.sendEmail)(adminEmail, `New Event Created: ${name}`, emailContent);
                console.log("✅ Admin notification email sent successfully on retry");
            }
            catch (retryError) {
                console.error("❌ Email retry failed:", retryError);
                // Consider implementing a queue system or notification for failed emails
            }
        }
    }
    catch (error) {
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
exports.createEvent = createEvent;
const updateEvent = async (req, res) => {
    try {
        const { id, name, date, location, description, rsvpMessage, rsvpBgColor, rsvpAccentColor, servicePackage, messageCycle, channelConfig, customMessageSequence, rsvpDeadline, eventEndDate, } = req.body;
        if (!id) {
            return res
                .status(400)
                .json({ message: "Event ID is required in form-data" });
        }
        // Find existing event so we can delete old IV if needed and determine safeName
        const existingEvent = await eventmodel_1.Event.findById(id);
        if (!existingEvent) {
            return res.status(404).json({ message: "Event not found" });
        }
        const updateData = {};
        const uploadedFiles = getUploadedFiles(req);
        const ivFile = getUploadedFileByField(uploadedFiles, "iv");
        if (name)
            updateData.name = name;
        if (date)
            updateData.date = date;
        if (location)
            updateData.location = location;
        if (description)
            updateData.description = description;
        if (rsvpMessage !== undefined)
            updateData.rsvpMessage = rsvpMessage;
        if (rsvpBgColor !== undefined)
            updateData.rsvpBgColor = rsvpBgColor;
        if (rsvpAccentColor !== undefined)
            updateData.rsvpAccentColor = rsvpAccentColor;
        if (servicePackage !== undefined) {
            updateData.servicePackage = normalizeRsvpServicePackage(servicePackage);
        }
        if (messageCycle !== undefined)
            updateData.messageCycle = messageCycle;
        if (channelConfig !== undefined)
            updateData.channelConfig = parseMaybeJson(channelConfig);
        if (customMessageSequence !== undefined)
            updateData.customMessageSequence = await resolveCustomMessageSequence(customMessageSequence, uploadedFiles, id || existingEvent._id?.toString() || existingEvent.name || "event");
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
                        await (0, s3Utils_1.deleteFromS3)(existingKey);
                    }
                    catch (delErr) {
                        console.warn("Could not delete previous IV from S3:", delErr);
                    }
                }
                const safeName = (name || existingEvent.name || "event").replace(/[^a-zA-Z0-9-_]/g, "_");
                const ivImageUrl = await (0, s3Utils_1.uploadToS3)(ivFile.buffer, `events/${safeName}_iv_${Date.now()}.png`, ivFile.mimetype || "image/png");
                updateData.iv = ivImageUrl;
            }
            catch (uploadErr) {
                console.error("Error uploading new IV:", uploadErr);
                // continue without failing the whole request; we'll still update other fields
            }
        }
        const updatedEvent = await eventmodel_1.Event.findByIdAndUpdate(id, updateData, {
            new: true,
        });
        if (!updatedEvent) {
            return res.status(404).json({ message: "Event not found" });
        }
        const effectiveServicePackage = normalizeRsvpServicePackage(updateData.servicePackage ?? existingEvent.servicePackage);
        const shouldSyncFullSchedules = effectiveServicePackage !== "invitation-only" &&
            (customMessageSequence !== undefined ||
                servicePackage !== undefined ||
                channelConfig !== undefined ||
                rsvpMessage !== undefined ||
                description !== undefined);
        let scheduleSync = null;
        if (shouldSyncFullSchedules) {
            scheduleSync = await (0, fullRsvpScheduleService_1.syncFullRsvpPendingSchedules)(updatedEvent, {
                replacePending: true,
            });
        }
        // Return updated event
        res.status(200).json({
            message: "Event updated successfully",
            event: updatedEvent,
            ...(scheduleSync ? { scheduleSync } : {}),
        });
    }
    catch (error) {
        console.error("Error updating event:", error);
        res.status(500).json({
            message: "Error updating event",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.updateEvent = updateEvent;
const getAllEvents = async (req, res) => {
    try {
        // Update event statuses before fetching
        const events = await eventmodel_1.Event.find({});
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
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching events" });
    }
};
exports.getAllEvents = getAllEvents;
const getEventById = async (req, res) => {
    try {
        const { id } = req.params;
        const event = await eventmodel_1.Event.findById(id);
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
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching events" });
    }
};
exports.getEventById = getEventById;
const updateRsvpSettings = async (req, res) => {
    try {
        const { id } = req.params;
        const { rsvpBgColor, rsvpAccentColor } = req.body;
        if (!id) {
            return res.status(400).json({ message: "Event ID is required" });
        }
        const updateData = {};
        if (rsvpBgColor !== undefined)
            updateData.rsvpBgColor = rsvpBgColor;
        if (rsvpAccentColor !== undefined)
            updateData.rsvpAccentColor = rsvpAccentColor;
        const updatedEvent = await eventmodel_1.Event.findByIdAndUpdate(id, updateData, {
            new: true,
        });
        if (!updatedEvent) {
            return res.status(404).json({ message: "Event not found" });
        }
        return res.status(200).json({
            message: "RSVP settings updated",
            event: updatedEvent,
        });
    }
    catch (error) {
        console.error("Error updating RSVP settings:", error);
        return res.status(500).json({
            message: "Error updating RSVP settings",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.updateRsvpSettings = updateRsvpSettings;
const updateRsvpFormSettings = async (req, res) => {
    try {
        const { id } = req.params;
        const { rsvpFormSettings } = req.body;
        if (!id) {
            return res.status(400).json({ message: "Event ID is required" });
        }
        const updatedEvent = await eventmodel_1.Event.findByIdAndUpdate(id, { rsvpFormSettings: rsvpFormSettings ?? null }, { new: true });
        if (!updatedEvent) {
            return res.status(404).json({ message: "Event not found" });
        }
        return res.status(200).json({
            message: "RSVP form settings updated",
            event: updatedEvent,
        });
    }
    catch (error) {
        console.error("Error updating RSVP form settings:", error);
        return res.status(500).json({
            message: "Error updating RSVP form settings",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.updateRsvpFormSettings = updateRsvpFormSettings;
const deleteAllEvents = async (req, res) => {
    try {
        await eventmodel_1.Event.deleteMany({});
        res.status(200).json({ message: "All events deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting all events" });
    }
};
exports.deleteAllEvents = deleteAllEvents;
const deleteSingleEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const event = await eventmodel_1.Event.findById(id);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
        }
        await eventmodel_1.Event.findByIdAndDelete(id);
        res.status(200).json({ message: "Event deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting event" });
    }
};
exports.deleteSingleEvent = deleteSingleEvent;
