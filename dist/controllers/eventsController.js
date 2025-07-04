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
const createEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, date, location, description } = req.body;
        // Validate form fields (excluding `iv`)
        const validateEvent = utils_1.creatEventSchema.validate({ name, date, location, description }, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ Error: validateEvent.error.details[0].message });
            return;
        }
        if (!req.file) {
            res.status(400).json({ Error: "PNG invitation image (iv) is required." });
            return;
        }
        // ⬇️ Upload `req.file.buffer` to Cloudinary or other image service
        // Placeholder for actual upload logic
        const ivImageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        const newEvent = yield eventmodel_1.Event.create({
            name,
            date,
            location,
            description,
            iv: ivImageUrl
        });
        // Send email notification (unchanged)
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
// export const updateEvent = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { name, date, location, description, iv } = req.body;
//     const validateEvent = updateEventSchema.validate(req.body, option);
//     if (validateEvent.error) {
//       res.status(400).json({ Error: validateEvent.error.details[0].message });
//     }
//     const updatedEvent = await Event.findByIdAndUpdate(
//       id,
//       { name, date, location, description, iv },
//       {
//         new: true,
//         runValidators: true,
//         context: "query",
//       }
//     );
//     const adminEmail = "softinvites@gmail.com";
//     const emailContent = `
//     <h2>📅 Event Updated</h2>
//     <p>Dear Admin,</p>
//     <p>An event has been updated on your platform:</p>
//     <ul>
//       <li><strong>Name:</strong> ${name}</li>
//       <li><strong>Date:</strong> ${date}</li>
//       <li><strong>Location:</strong> ${location}</li>
//     </ul>
//     <p>Log in to view more details.</p>
//   `;
//   try {
//     await sendEmail(adminEmail, `Event Updated: ${name}`, emailContent); // 🔧 Subject corrected
//     console.log("Admin email sent successfully.");
//   } catch (emailError) {
//     console.error("Error sending admin email:", emailError);
//   }
//     res
//       .status(200)
//       .json({ message: "Event updated successfully", updatedEvent });
//   } catch (error) {
//     res.status(500).json({ message: "Error updating event" });
//   }
// };
const updateEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, date, location, description } = req.body;
        // Validate body (excluding file)
        const validateEvent = utils_1.updateEventSchema.validate({ name, date, location, description }, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ Error: validateEvent.error.details[0].message });
            return;
        }
        // Prepare update object
        const updateData = { name, date, location, description };
        if (req.file) {
            const ivImageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
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
        // Send admin email
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
        console.error("Error updating event:", error);
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
