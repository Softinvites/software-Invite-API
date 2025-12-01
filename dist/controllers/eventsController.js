"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSingleEvent = exports.deleteAllEvents = exports.getEventById = exports.getAllEvents = exports.updateEvent = exports.createEvent = void 0;
const eventmodel_1 = require("../models/eventmodel");
const utils_1 = require("../utils/utils");
const emailService_1 = require("../library/helpers/emailService");
const s3Utils_1 = require("../utils/s3Utils");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION });
// export const createEvent = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { name, date, location, description } = req.body;
//     const validateEvent = createEventSchema.validate(
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
//     const ivImageUrl = await uploadToS3(
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
//     res.status(201).json({ message: "Event created successfully", event: newEvent });
//   } catch (error) {
//     res.status(500).json({ message: "Error creating event", error });
//   }
// };
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
// export const createEvent = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { name, date, location, description } = req.body;
//     // ✅ Validate event fields
//     const validateEvent = createEventSchema.validate(
//       { name, date, location, description },
//       option
//     );
//     if (validateEvent.error) {
//       res.status(400).json({ error: validateEvent.error.details[0].message });
//       return;
//     }
//     let ivImageUrl: string | null = null;
//     // ✅ Upload IV image if provided
//     if (req.file) {
//       const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
//       ivImageUrl = await uploadToS3(
//         req.file.buffer,
//         `events/${safeName}_iv_${Date.now()}.png`,
//         req.file.mimetype
//       );
//     }
//     // ✅ Create event in DB
//     const newEvent = await Event.create({
//       name,
//       date,
//       location,
//       description,
//       iv: ivImageUrl,
//     });
//     // ✅ Respond immediately so frontend doesn’t break
//     res.status(201).json({
//       message: "Event created successfully",
//       event: newEvent,
//     });
//     // ✅ Fire-and-forget email (doesn’t block response)
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
//     sendEmail(adminEmail, `New Event Created: ${name}`, emailContent)
//       .catch((err) => console.error("Email failed:", err));
//   } catch (error: any) {
//     console.error("Error creating event:", error);
//     res.status(500).json({
//       message: "Error creating event",
//       error: error.message || "Unknown error",
//     });
//   }
// };
const createEvent = async (req, res) => {
    try {
        // Log environment configuration
        console.log('Environment check:', {
            NODE_ENV: process.env.NODE_ENV,
            EMAIL_LAMBDA_FUNCTION_NAME: process.env.EMAIL_LAMBDA_FUNCTION_NAME,
            EMAIL_FROM: process.env.EMAIL_FROM,
            AWS_REGION: process.env.AWS_REGION
        });
        const { name, date, location, description } = req.body;
        // ✅ Validate event fields
        const validateEvent = utils_1.createEventSchema.validate({ name, date, location, description }, utils_1.option);
        if (validateEvent.error) {
            res.status(400).json({ error: validateEvent.error.details[0].message });
            return;
        }
        let ivImageUrl = null;
        // ✅ Upload IV image if provided
        if (req.file) {
            try {
                const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
                ivImageUrl = await (0, s3Utils_1.uploadToS3)(req.file.buffer, `events/${safeName}_iv_${Date.now()}.png`, req.file.mimetype);
                console.log('✅ Image uploaded successfully:', ivImageUrl);
            }
            catch (uploadError) {
                console.error('❌ Image upload failed:', uploadError);
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
        });
        console.log('✅ Event created successfully:', newEvent.id);
        // ✅ Respond immediately so frontend doesn't break
        res.status(201).json({
            message: "Event created successfully",
            event: newEvent,
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
            console.log('📧 Attempting to send admin notification email...');
            await (0, emailService_1.sendEmail)(adminEmail, `New Event Created: ${name}`, emailContent);
            console.log('✅ Admin notification email sent successfully');
        }
        catch (emailError) {
            console.error('❌ Failed to send admin notification:', emailError);
            // Implement retry logic
            try {
                console.log('🔄 Retrying email send...');
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                await (0, emailService_1.sendEmail)(adminEmail, `New Event Created: ${name}`, emailContent);
                console.log('✅ Admin notification email sent successfully on retry');
            }
            catch (retryError) {
                console.error('❌ Email retry failed:', retryError);
                // Consider implementing a queue system or notification for failed emails
            }
        }
    }
    catch (error) {
        console.error("❌ Error creating event:", {
            error: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(500).json({
            message: "Error creating event",
            error: error.message || "Unknown error",
        });
    }
};
exports.createEvent = createEvent;
// export const updateEvent = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const { name, date, location, description } = req.body;
//     console.log("UpdateEvent req.params:", req.params);
// console.log("UpdateEvent req.body:", req.body);
//     const validateEvent = updateEventSchema.validate(
//       { name, date, location, description },
//       option
//     );
//     if (validateEvent.error) {
//       res.status(400).json({ Error: validateEvent.error.details[0].message });
//       return;
//     }
//     const updateData: any = { name, date, location, description };
//     if (req.file) {
//       const existing = await Event.findById(id);
//       if (existing?.iv) {
//         try {
//           const key = new URL(existing.iv).pathname.slice(1);
//           await deleteFromS3(key);
//         } catch (err) {
//           console.warn("Could not delete old IV image from S3:", err);
//         }
//       }
//       const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
//       const ivImageUrl = await uploadToS3(
//         req.file.buffer,
//         `events/${safeName}_iv_${Date.now()}.png`,
//         req.file.mimetype
//       );
//       updateData.iv = ivImageUrl;
//     }
//     const updatedEvent = await Event.findByIdAndUpdate(id, updateData, {
//       new: true,
//       runValidators: true,
//       context: "query",
//     });
//     if (!updatedEvent) {
//       res.status(404).json({ message: "Event not found" });
//       return;
//     }
//     // Email admin
//     const adminEmail = "softinvites@gmail.com";
//     const emailContent = `
//       <h2>📅 Event Updated</h2>
//       <p>Dear Admin,</p>
//       <p>An event has been updated on your platform:</p>
//       <ul>
//         <li><strong>Name:</strong> ${updatedEvent.name}</li>
//         <li><strong>Date:</strong> ${updatedEvent.date}</li>
//         <li><strong>Location:</strong> ${updatedEvent.location}</li>
//       </ul>
//       <p>Log in to view more details.</p>
//     `;
//     await sendEmail(adminEmail, `Event Updated: ${updatedEvent.name}`, emailContent);
//     await lambdaClient.send(new InvokeCommand({
//   FunctionName: process.env.BACKUP_LAMBDA!,
//   InvocationType: 'Event', // async
//   Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
// }));
//     res.status(200).json({ message: "Event updated successfully", updatedEvent });
//   } catch (error) {
//     res.status(500).json({ message: "Error updating event", error });
//   }
// };
// export const updateEvent = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const { name, date, location, description } = req.body;
//     // ✅ Validate event fields
//     const validateEvent = updateEventSchema.validate(
//       { name, date, location, description },
//       { abortEarly: false }
//     );
//     if (validateEvent.error) {
//       res.status(400).json({ error: validateEvent.error.details[0].message });
//       return;
//     }
//     // ✅ Find existing event
//     const event = await Event.findById(id);
//     if (!event) {
//       res.status(404).json({ message: "Event not found" });
//       return;
//     }
//     // ✅ Upload new IV if provided
//     let ivImageUrl = event.iv; // keep existing if no new upload
//     if (req.file) {
//       const safeName = name.replace(/[^a-zA-Z0-9-_]/g, "_");
//       ivImageUrl = await uploadToS3(
//         req.file.buffer,
//         `events/${safeName}_iv_${Date.now()}.png`,
//         req.file.mimetype
//       );
//     }
//     // ✅ Update fields
//     event.name = name || event.name;
//     event.date = date || event.date;
//     event.location = location || event.location;
//     event.description = description || event.description;
//     event.iv = ivImageUrl;
//     await event.save();
//         // Email admin
//     const adminEmail = "softinvites@gmail.com";
//     const emailContent = `
//       <h2>📅 Event Updated</h2>
//       <p>Dear Admin,</p>
//       <p>An event has been updated on your platform:</p>
//       <ul>
//         <li><strong>Name:</strong> ${event.name}</li>
//         <li><strong>Date:</strong> ${event.date}</li>
//         <li><strong>Location:</strong> ${event.location}</li>
//       </ul>
//       <p>Log in to view more details.</p>
//     `;
//     await sendEmail(adminEmail, `Event Updated: ${event.name}`, emailContent);
//     console.log("BACKUP_LAMBDA env:", process.env.BACKUP_LAMBDA);
// const backupLambda = process.env.BACKUP_LAMBDA;
// if (!backupLambda) {
//   console.error("❌ BACKUP_LAMBDA is undefined in Lambda env");
// } else {
//   console.log("✅ Using BACKUP_LAMBDA:", backupLambda);
// }
// await lambdaClient.send(new InvokeCommand({
//   FunctionName: backupLambda ?? "softinvites-backend-dev-backup",
//   InvocationType: 'Event',
//   Payload: Buffer.from(JSON.stringify({}))
// }));
//     res.status(200).json({
//       message: "Event updated successfully",
//       event,
//     });
//   } catch (error: any) {
//     console.error("Error updating event:", error);
//     res.status(500).json({
//       message: "Error updating event",
//       error: error.message || "Unknown error",
//     });
//   }
// };
// controllers/event.ts
const updateEvent = async (req, res) => {
    try {
        const { id, name, date, location, description } = req.body;
        if (!id) {
            return res.status(400).json({ message: "Event ID is required in form-data" });
        }
        // Check if file was uploaded
        const iv = req.file ? req.file.path : undefined;
        const updatedEvent = await eventmodel_1.Event.findByIdAndUpdate(id, {
            ...(name && { name }),
            ...(date && { date }),
            ...(location && { location }),
            ...(description && { description }),
            ...(iv && { iv }),
        }, { new: true });
        if (!updatedEvent) {
            return res.status(404).json({ message: "Event not found" });
        }
        res.status(200).json({
            message: "Event updated successfully",
            event: updatedEvent,
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
