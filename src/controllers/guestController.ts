import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import csvParser from "csv-parser";
import multer from "multer";
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";

// Configure multer for file uploads
const upload = multer({ dest: "uploads/" });

// **Add a Guest & Generate QR Code**
export const addGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, phone, eventId } = req.body;

    const validateGuest = createGuestSchema.validate(req.body, option);

    if (validateGuest.error) {
      res.status(400).json({ Error: validateGuest.error.details[0].message });
    }

    // Generate a unique QR code
    const qrCodeData = `${firstName}-${lastName}-${eventId}`;
    const qrCode = await QRCode.toDataURL(qrCodeData);

    const newGuest = new Guest({
      firstName,
      lastName,
      email,
      phone,
      qrCode,
      event: eventId,
    });

    await newGuest.save();

    res
      .status(201)
      .json({ message: "Guest added successfully", guest: newGuest });
  } catch (error) {
    res.status(500).json({ message: "Error adding guest" });
  }
};

// **Update Guest **
export const updateGuest = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { guestId } = req.params;
    const { firstName, lastName, email, phone, eventId, regenerateQr } =
      req.body;

    // Validate input
    const validateGuest = updateGuestSchema.validate(req.body);
    if (validateGuest.error) {
      res.status(400).json({ error: validateGuest.error.details[0].message });
    }

    // Find the guest by ID
    const guest = await Guest.findById(guestId);
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // Update guest fields
    guest.firstName = firstName || guest.firstName;
    guest.lastName = lastName || guest.lastName;
    guest.email = email || guest.email;
    guest.phone = phone || guest.phone;
    guest.event = eventId || guest.event;

    // Regenerate QR code if requested
    if (regenerateQr) {
      const qrCodeData = `${guest.firstName}-${guest.lastName}-${guest.event}`;
      guest.qrCode = await QRCode.toDataURL(qrCodeData);
    }

    await guest.save();

    res.status(200).json({ message: "Guest updated successfully", guest });
  } catch (error) {
    res.status(500).json({ message: "Error updating guest" });
  }
};

// **Import Guests from CSV**
export const importGuests = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const guests: any[] = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => guests.push(row))
      .on("end", async () => {
        try {
          for (const guest of guests) {
            const qrCodeData = `${guest.firstName}-${guest.lastName}-${guest.eventId}`;
            const qrCode = await QRCode.toDataURL(qrCodeData);

            const newGuest = new Guest({
              firstName: guest.firstName,
              lastName: guest.lastName,
              email: guest.email,
              phone: guest.phone,
              qrCode,
              event: guest.eventId,
            });

            await newGuest.save();
          }

          fs.unlink(filePath, (err) => {
            if (err) console.error("Error deleting CSV file:", err);
          });

          res.status(201).json({ message: "Guests imported successfully" });
        } catch (saveError) {
          console.error("Error saving guests:", saveError);
          res.status(500).json({ message: "Error processing guests" });
        }
      })
      .on("error", (parseError) => {
        console.error("CSV parsing error:", parseError);
        res.status(500).json({ message: "Error parsing CSV file" });
      });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error importing guests" });
  }
};

// **Download QR Codes as PNG (Single)**
export const downloadQRCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { guestId } = req.params;
    const guest = await Guest.findById(guestId);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    const qrPath = path.join(
      __dirname,
      `../../qrcodes/${guest.firstName}-${guest.lastName}.png`
    );

    await QRCode.toFile(qrPath, guest.qrCode);

    res.download(qrPath, `${guest.firstName}-${guest.lastName}.png`, (err) => {
      if (err) {
        console.error("Download error:", err);
        return res.status(500).json({ message: "Error downloading QR code" });
      }
      fs.unlink(qrPath, (unlinkErr) => {
        if (unlinkErr) console.error("Error deleting file:", unlinkErr);
      });
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error downloading QR code" });
  }
};

// **Download QR Codes as ZIP**
export const downloadAllQRCodes = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const guests = await Guest.find({});
    if (!guests.length) {
      res.status(404).json({ message: "No guests found" });
      return;
    }

    const zipPath = path.join(__dirname, "../../qrcodes.zip");
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip");

    archive.pipe(output);

    const qrPaths: string[] = [];

    for (const guest of guests) {
      const qrPath = path.join(
        __dirname,
        `../../qrcodes/${guest.firstName}-${guest.lastName}.png`
      );
      await QRCode.toFile(qrPath, guest.qrCode);
      archive.file(qrPath, {
        name: `${guest.firstName}-${guest.lastName}.png`,
      });
      qrPaths.push(qrPath);
    }

    await archive.finalize();

    res.download(zipPath, "qrcodes.zip", (err) => {
      if (err) {
        console.error("Download error:", err);
        return res.status(500).json({ message: "Error downloading QR codes" });
      }

      // Clean up QR files and ZIP
      qrPaths.forEach((qr) =>
        fs.unlink(
          qr,
          (err) => err && console.error("Error deleting QR file:", err)
        )
      );
      fs.unlink(
        zipPath,
        (err) => err && console.error("Error deleting ZIP file:", err)
      );
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error downloading QR codes" });
  }
};

// **Get All Guests for an Event**
export const getGuestsByEvent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const guests = await Guest.find({ event: eventId });

    res.status(200).json({ guests });
  } catch (error) {
    res.status(500).json({ message: "Error fetching guests" });
  }
};

// **Get Single Guest for an Event**
export const getGuestById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { guestId } = req.params; // Extract guestId from the route parameters
    const guest = await Guest.findById(guestId); // Find the guest by their ID

    if (!guest) {
      res.status(404).json({ message: "Guest not found" }); // Handle if no guest is found
    }

    res.status(200).json({ guest }); // return the guest data if found
  } catch (error) {
    res.status(500).json({ message: "Error fetching guest" }); // Handle any errors
  }
};

// **Delete Single Guest by ID**
export const deleteGuestById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { guestId } = req.params; // Extract guestId from the route parameters

    const guest = await Guest.findByIdAndDelete(guestId); // Delete the guest by their ID

    if (!guest) {
      res.status(404).json({ message: "Guest not found" }); // Handle case if no guest is found
    }

    res.status(200).json({ message: "Guest deleted successfully" }); // Respond with success message
  } catch (error) {
    res.status(500).json({ message: "Error deleting guest" }); // Handle any errors
  }
};

// **Delete Guests by Event ID**
export const deleteGuestsByEvent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params; // Extract eventId from route parameters

    const result = await Guest.deleteMany({ event: eventId }); // Delete all guests associated with the event

    if (result.deletedCount === 0) {
      res.status(404).json({ message: "No guests found for this event" }); // Handle if no guests were deleted
    }

    res.status(200).json({ message: "Guests deleted successfully" }); // Respond with success message
  } catch (error) {
    res.status(500).json({ message: "Error deleting guests" }); // Handle any errors
  }
};

// **Scan QR Code for Check-in**
export const scanQRCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { qrData } = req.body;
    const guest = await Guest.findOne({ qrCode: qrData });

    if (!guest) {
      res.status(404).json({ message: "Invalid QR Code" });
      return;
    }

    guest.checkedIn = true;
    await guest.save();

    res.status(200).json({ message: "Guest checked in successfully", guest });
  } catch (error) {
    res.status(500).json({ message: "Error scanning QR code" });
  }
};

// **Generate Analytics (Used & Unused QR Codes)**
export const generateAnalytics = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;

    const totalGuests = await Guest.countDocuments({ event: eventId });
    const checkedInGuests = await Guest.countDocuments({
      event: eventId,
      checkedIn: true,
    });
    const unusedCodes = totalGuests - checkedInGuests;

    res.status(200).json({
      eventId,
      totalGuests,
      checkedInGuests,
      unusedCodes,
    });
  } catch (error) {
    res.status(500).json({ message: "Error generating analytics" });
  }
};
