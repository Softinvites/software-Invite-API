"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSingleEvent = exports.deleteAllEvents = exports.getEventById = exports.getAllEvents = exports.updateEvent = exports.createEvent = void 0;
const eventmodel_1 = require("../models/eventmodel");
const utils_1 = require("../utils/utils");
const emailService_1 = require("../library/helpers/emailService");
const s3Utils_1 = require("../utils/s3Utils");
const createEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, date, location, description } = req.body;
        const validateEvent = utils_1.createEventSchema.validate({ name, date, location, description }, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ Error: validateEvent.error.details[0].message });
            return;
        }
        if (!req.file) {
            res.status(400).json({ Error: "PNG invitation image (iv) is required." });
            return;
        }
        // Upload image to S3
        const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
        const ivImageUrl = yield (0, s3Utils_1.uploadToS3)(req.file.buffer, `events/${safeName}_iv_${Date.now()}.png`, req.file.mimetype);
        const newEvent = yield eventmodel_1.Event.create({
            name,
            date,
            location,
            description,
            iv: ivImageUrl,
        });
        // Email admin
        const adminEmail = "softinvites@gmail.com";
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
        yield (0, emailService_1.sendEmail)(adminEmail, `New Event Created: ${name}`, emailContent);
        res.status(201).json({ message: "Event created successfully", event: newEvent });
    }
    catch (error) {
        res.status(500).json({ message: "Error creating event", error });
    }
});
exports.createEvent = createEvent;
// export const createEvent = async (req: Request, res: Response) => {
//   try {
//     const {
//       name,
//       date,
//       location,
//       description,
//       ivBase64, // base64 image string
//     } = req.body;
//     // ✅ Validate
//     const { error } = createEventSchema.validate(req.body);
//     if (error) {
//       return res.status(400).json({ message: "Validation error", error });
//     }
//     // ✅ Create Event
//     const event = new Event({
//       name,
//       date,
//       location,
//       description,
//       iv: ivBase64, // store the base64 string
//     });
//     await event.save();
//     // ✅ Send email with image (optional step)
//     const adminEmail = "softinvites@gmail.com";
//     const emailContent = `
//       <h2>🎉 New Event Created</h2>
//       <p>Dear Admin,</p>
//       <p>A new event has been created on your platform:</p>
//       <ul>
//         <li><strong>Name:</strong> ${name}</li>
//         <li><strong>Date:</strong> ${date}</li>
//         <li><strong>Location:</strong> ${location}</li>
//       </ul>
//       <p>Log in to view more details.</p>
//     `;
//     await sendEmail(adminEmail, `New Event Created: ${name}`, emailContent);
//     res.status(201).json({ message: "Event created successfully", event });
//   } catch (error) {
//     console.error("Create Event Error:", error);
//     res.status(500).json({ message: "Server error", error });
//   }
// };
const updateEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, date, location, description } = req.body;
        const validateEvent = utils_1.updateEventSchema.validate({ name, date, location, description }, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ Error: validateEvent.error.details[0].message });
            return;
        }
        const updateData = { name, date, location, description };
        if (req.file) {
            const existing = yield eventmodel_1.Event.findById(id);
            if (existing === null || existing === void 0 ? void 0 : existing.iv) {
                try {
                    const key = new URL(existing.iv).pathname.slice(1);
                    yield (0, s3Utils_1.deleteFromS3)(key);
                }
                catch (err) {
                    console.warn("Could not delete old IV image from S3:", err);
                }
            }
            const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
            const ivImageUrl = yield (0, s3Utils_1.uploadToS3)(req.file.buffer, `events/${safeName}_iv_${Date.now()}.png`, req.file.mimetype);
            updateData.iv = ivImageUrl;
        }
        const updatedEvent = yield eventmodel_1.Event.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true,
            context: "query",
        });
        if (!updatedEvent) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        // Email admin
        const adminEmail = "softinvites@gmail.com";
        const emailContent = `
      <h2>📅 Event Updated</h2>
      <p>Dear Admin,</p>
      <p>An event has been updated on your platform:</p>
      <ul>
        <li><strong>Name:</strong> ${updatedEvent.name}</li>
        <li><strong>Date:</strong> ${updatedEvent.date}</li>
        <li><strong>Location:</strong> ${updatedEvent.location}</li>
      </ul>
      <p>Log in to view more details.</p>
    `;
        yield (0, emailService_1.sendEmail)(adminEmail, `Event Updated: ${updatedEvent.name}`, emailContent);
        res.status(200).json({ message: "Event updated successfully", updatedEvent });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating event", error });
    }
});
exports.updateEvent = updateEvent;
const getAllEvents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const events = yield eventmodel_1.Event.find({});
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
});
exports.getAllEvents = getAllEvents;
const getEventById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const event = yield eventmodel_1.Event.findById(id);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
        }
        res.status(200).json({ message: "Event successfully fetched", event });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching events" });
    }
});
exports.getEventById = getEventById;
const deleteAllEvents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield eventmodel_1.Event.deleteMany({});
        res.status(200).json({ message: "All events deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting all events" });
    }
});
exports.deleteAllEvents = deleteAllEvents;
const deleteSingleEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const event = yield eventmodel_1.Event.findById(id);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
        }
        yield eventmodel_1.Event.findByIdAndDelete(id);
        res.status(200).json({ message: "Event deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting event" });
    }
});
exports.deleteSingleEvent = deleteSingleEvent;
