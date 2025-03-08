import { Request, Response } from "express";
import { Event } from "../models/eventmodel";
import { creatEventSchema, updateEventSchema, option } from "../utils/utils";

export const createEvent = async (req: Request, res: Response) => {
  try {
    const { name, date, location } = req.body;

    const validateEvent = creatEventSchema.validate(req.body, option);

    if (validateEvent.error) {
      res.status(400).json({ Error: validateEvent.error.details[0].message });
    }

    const newEvent = await Event.create({ name, date, location });
    res
      .status(201)
      .json({ message: "Event created successfully", event: newEvent });
  } catch (error) {
    res.status(500).json({ message: "Error creating event" });
  }
};

export const updateEvent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, date, location } = req.body;

    const validateEvent = updateEventSchema.validate(req.body, option);

    if (validateEvent.error) {
      res.status(400).json({ Error: validateEvent.error.details[0].message });
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      id,
      { name, date, location },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    );
    res
      .status(200)
      .json({ message: "Event updated successfully", updatedEvent });
  } catch (error) {
    res.status(500).json({ message: "Error updating event" });
  }
};

export const getAllEvents = async (req: Request, res: Response) => {
  try {
    const events = await Event.find({});
    if(events.length == 0){
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
    }
    res.status(200).json({ message: "Event successfully fetched", event });
  } catch (error) {
    res.status(500).json({ message: "Error fetching events" });
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
