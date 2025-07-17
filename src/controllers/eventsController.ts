import { Request, Response } from "express";
import { Event } from "../models/eventmodel";
import { createEventSchema, updateEventSchema, option } from "../utils/utils";
import { sendEmail } from "../library/helpers/emailService";
import { deleteFromS3, uploadToS3 } from '../utils/s3Utils';

// export const createEvent = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { name, date, location, description } = req.body;

//     const validateEvent = creatEventSchema.validate(
//       { name, date, location, description },
//       option
//     );
//     if (validateEvent.error) {
//       res.status(400).json({ Error: validateEvent.error.details[0].message });
//       return;
//     }

//     if (!req.file) {
//       res.status(400).json({ Error: "PNG invitation image (iv) is required." });
//       return;
//     }

//     // Upload image to S3
//     const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
// const ivImageUrl = await uploadToS3(
//   req.file.buffer,
//   `events/${safeName}_iv_${Date.now()}.png`,
//   req.file.mimetype
// );

//     const newEvent = await Event.create({
//       name,
//       date,
//       location,
//       description,
//       iv: ivImageUrl,
//     });

//     // Email admin
    // const adminEmail = "softinvites@gmail.com";
    // const emailContent = `
    //   <h2>🎉 New Event Created</h2>
    //   <p>Dear Admin,</p>
    //   <p>A new event has been created on your platform:</p>
    //   <ul>
    //     <li><strong>Name:</strong> ${name}</li>
    //     <li><strong>Date:</strong> ${date}</li>
    //     <li><strong>Location:</strong> ${location}</li>
    //   </ul>
    //   <p>Log in to view more details.</p>
    // `;
    // await sendEmail(adminEmail, `New Event Created: ${name}`, emailContent);

//     res.status(201).json({ message: "Event created successfully", event: newEvent });
//   } catch (error) {
//     res.status(500).json({ message: "Error creating event", error });
//   }
// };

export const createEvent = async (req: Request, res: Response) => {
  try {
    const {
      name,
      date,
      location,
      description,
      ivBase64, // base64 image string
    } = req.body;

    // ✅ Validate
    const { error } = createEventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: "Validation error", error });
    }

    // ✅ Create Event
    const event = new Event({
      name,
      date,
      location,
      description,
      iv: ivBase64, // store the base64 string
    });

    await event.save();

    // ✅ Send email with image (optional step)
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
    await sendEmail(adminEmail, `New Event Created: ${name}`, emailContent);

    res.status(201).json({ message: "Event created successfully", event });
  } catch (error) {
    console.error("Create Event Error:", error);
    res.status(500).json({ message: "Server error", error });
  }
};


export const updateEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, date, location, description } = req.body;

    const validateEvent = updateEventSchema.validate(
      { name, date, location, description },
      option
    );
    if (validateEvent.error) {
      res.status(400).json({ Error: validateEvent.error.details[0].message });
      return;
    }

    const updateData: any = { name, date, location, description };

    if (req.file) {
      const existing = await Event.findById(id);
      if (existing?.iv) {
        try {
          const key = new URL(existing.iv).pathname.slice(1);
          await deleteFromS3(key);
        } catch (err) {
          console.warn("Could not delete old IV image from S3:", err);
        }
      }
    
      const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
      const ivImageUrl = await uploadToS3(
        req.file.buffer,
        `events/${safeName}_iv_${Date.now()}.png`,
        req.file.mimetype
      );
      updateData.iv = ivImageUrl;
    }
    

    const updatedEvent = await Event.findByIdAndUpdate(id, updateData, {
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
    await sendEmail(adminEmail, `Event Updated: ${updatedEvent.name}`, emailContent);

    res.status(200).json({ message: "Event updated successfully", updatedEvent });
  } catch (error) {
    res.status(500).json({ message: "Error updating event", error });
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
