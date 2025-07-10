import { Request, Response } from "express";
import { Event } from "../models/eventmodel";
import { creatEventSchema, updateEventSchema, option } from "../utils/utils";
import { sendEmail } from "../library/helpers/emailService";
import { cloudinary } from "../library/helpers/uploadImage"; // Adjust import as needed

export const createEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, date, location, description } = req.body;

    // Validate form fields (excluding `iv`)
    const validateEvent = creatEventSchema.validate({ name, date, location, description }, option);
    if (validateEvent.error) {
       res.status(400).json({ Error: validateEvent.error.details[0].message });
       return;
    }

    let ivImageUrl: string | undefined;

    // Check if a file was uploaded
    if (req.file) {
      // ⬇️ Upload req.file.buffer to Cloudinary or other image service
      // Placeholder for actual upload logic
      ivImageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    const newEventData: any = {
      name,
      date,
      location,
      description,
    };

    if (ivImageUrl) {
      newEventData.iv = ivImageUrl;
    }

    const newEvent = await Event.create(newEventData);

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
    await sendEmail(adminEmail, `New Event Created: ${name}`, emailContent);

    res.status(201).json({ message: "Event created successfully", event: newEvent });
  } catch (error) {
    res.status(500).json({ message: "Error creating event", error });
  }
};

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

export const updateEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, date, location, description } = req.body;

    // Validate body (excluding file)
    const validateEvent = updateEventSchema.validate({ name, date, location, description }, option);
    if (validateEvent.error) {
      res.status(400).json({ Error: validateEvent.error.details[0].message });
      return;
    }

    // Prepare update object
    const updateData: any = { name, date, location, description };

    if (req.file) {
      const ivImageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      updateData.iv = ivImageUrl;
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    );

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

    await sendEmail(adminEmail, `Event Updated: ${updatedEvent.name}`, emailContent);

    res.status(200).json({ message: "Event updated successfully", updatedEvent });
  } catch (error) {
    console.error("Error updating event:", error);
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
