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
const createEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, date, location, description } = req.body;
        const validateEvent = utils_1.creatEventSchema.validate(req.body, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ Error: validateEvent.error.details[0].message });
        }
        const newEvent = yield eventmodel_1.Event.create({ name, date, location, description });
        res
            .status(201)
            .json({ message: "Event created successfully", event: newEvent });
    }
    catch (error) {
        res.status(500).json({ message: "Error creating event" });
    }
});
exports.createEvent = createEvent;
const updateEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, date, location, description } = req.body;
        const validateEvent = utils_1.updateEventSchema.validate(req.body, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ Error: validateEvent.error.details[0].message });
        }
        const updatedEvent = yield eventmodel_1.Event.findByIdAndUpdate(id, { name, date, location, description }, {
            new: true,
            runValidators: true,
            context: "query",
        });
        res
            .status(200)
            .json({ message: "Event updated successfully", updatedEvent });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating event" });
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
