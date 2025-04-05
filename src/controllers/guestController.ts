import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
import QRCode from "qrcode-svg";
import archiver from "archiver";
import xlsx from "xlsx";
import * as fastcsv from "fast-csv";
import { cloudinary } from "../library/helpers/uploadImage";
import { UploadApiResponse } from "cloudinary";
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";
import stream from "stream";
import fetch from "node-fetch";
import { sendEmail } from "../library/helpers/emailService";
import { rgbToHex } from "../utils/colorUtils";
import sharp from "sharp";
import jwt from "jsonwebtoken";

// **Add a Guest & Generate QR Code**
export const addGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      eventId,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
    } = req.body;

    // Validate input
    const validateGuest = createGuestSchema.validate(req.body, option);
    if (validateGuest.error) {
      res.status(400).json({ Error: validateGuest.error.details[0].message });
      return;
    }

    const event = await Event.findById(eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const eventDate = event.date;
    const eventLocation = event.location;
    const eventDescription = event.description;

    const bgColorHex = rgbToHex(qrCodeBgColor);
    const centerColorHex = rgbToHex(qrCodeCenterColor);
    const edgeColorHex = rgbToHex(qrCodeEdgeColor);

    const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nEvent Description: ${eventDescription}`;

    // Generate SVG QR Code
    const qr = new QRCode({
      content: qrCodeData,
      padding: 4,
      width: 256,
      height: 256,
      color: edgeColorHex,
      background: bgColorHex,
      xmlDeclaration: false,
    });

    let svg = qr.svg();

    // Insert the gradient in <defs>
    svg = svg.replace(
      /<svg([^>]*)>/,
      `<svg$1>
      <defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
        </radialGradient>
      </defs>`
    );

    // Apply the gradient directly to QR code squares
    svg = svg.replace(
      /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
      (match, group1, group2) => {
        const isBoundingRect = /x="0".*y="0"/.test(group1);
        return isBoundingRect
          ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
          : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
      }
    );

    // Convert SVG to PNG using sharp
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // Upload PNG to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload_stream(
      {
        folder: "qr_codes",
        public_id: `${firstName}_${lastName}_qr`,
        overwrite: true,
        format: "png",
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary Upload Error:", error);
          res.status(500).json({ message: "Error uploading QR code", error });
          return;
        }

        const qrCodeUrl = result?.secure_url;

        // Save guest with QR Code URL
        const newGuest = new Guest({
          firstName,
          lastName,
          email,
          phone,
          qrCode: qrCodeUrl,
          qrCodeBgColor,
          qrCodeCenterColor,
          qrCodeEdgeColor,
          eventId,
        });

        newGuest
          .save()
          .then(() => {
            // Send email with QR Code
            const emailContent = `
            <h2>Welcome to ${eventName}!</h2>
            <p>Dear ${firstName},</p>
            <p>We are delighted to invite you to <strong>${eventName}</strong>. </p>

            <h3>Event Details:</h3>
            <p><strong>Date:</strong> ${eventDate}</p>
            <p><strong>Location:</strong> ${event.location}</p>
            <p><strong>Description:</strong> ${event.description}</p>

            <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
            <img src="${qrCodeUrl}" alt="QR Code" />

            <p>See you at ${eventName}!</p>
            `;

            sendEmail(email, `Your Invitation to ${eventName}`, emailContent)
              .then(() => console.log("Email sent successfully!"))
              .catch((error) => console.error("Error sending email:", error));

            res
              .status(201)
              .json({ message: "Guest created successfully", guest: newGuest });
          })
          .catch((saveError) => {
            console.error("Error saving guest:", saveError);
            res.status(500).json({ message: "Error saving guest", saveError });
          });
      }
    );

    uploadResponse.end(pngBuffer); 
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error creating guest", error });
  }
};

// ✅ Import Guests from CSV/Excel and delete from Cloudinary
export const importGuests = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const uploadResponse = await cloudinary.uploader.upload(req.file.path, {
      resource_type: "raw",
      folder: "uploads",
    });

    const fileUrl = uploadResponse.secure_url;
    const publicId = uploadResponse.public_id;

    const guests: any[] = [];

    if (req.file.mimetype === "text/csv") {
      const fetchResponse = await fetch(fileUrl);
      const csvData = await fetchResponse.text();

      fastcsv
        .parseString(csvData, { headers: true })
        .on("data", (row: any) => guests.push(row))
        .on("end", async () => {
          try {
            await processGuests(guests, res);
          } finally {
            await cloudinary.uploader.destroy(publicId);
          }
        })
        .on("error", async (err: Error) => {
          console.error("CSV parsing error:", err);
          await cloudinary.uploader.destroy(publicId);
          res.status(500).json({ message: "Error parsing CSV file" });
        });
    } else if (req.file.mimetype.includes("spreadsheet")) {
      const fetchResponse = await fetch(fileUrl);
      const arrayBuffer = await fetchResponse.arrayBuffer();
      const excelData = Buffer.from(arrayBuffer);

      const workbook = xlsx.read(excelData);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data: Array<{ [key: string]: any }> =
        xlsx.utils.sheet_to_json(sheet);

      guests.push(...data);

      try {
        await processGuests(guests, res);
      } finally {
        await cloudinary.uploader.destroy(publicId);
      }
    } else {
      await cloudinary.uploader.destroy(publicId);
      res.status(400).json({ message: "Invalid file type" });
    }
  } catch (error) {
    console.error("Error importing guests:", error);
    res.status(500).json({ message: "Error importing guests" });
  }
};

// ✅ Process Imported Guests from CSV/Excel
const processGuests = async (
  guests: Array<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    eventId: string;
    qrCodeBgColor: string;
    qrCodeCenterColor: string;
    qrCodeEdgeColor: string;
  }>,
  res: Response
): Promise<void> => {
  try {
    const guestPromises = guests.map(async (guest) => {
      const {
        firstName,
        lastName,
        email,
        phone,
        eventId,
        qrCodeBgColor,
        qrCodeCenterColor,
        qrCodeEdgeColor,
      } = guest;

      if (!email) return null;

      const existingGuest = await Guest.findOne({ email, eventId });
      if (existingGuest) return null;

      const event = await Event.findById(eventId);
      if (!event) return null;

      const eventName = event.name;
      const eventDate = event.date;
      const eventLocation = event.location;
      const eventDescription = event.description;

      const bgColorHex = rgbToHex(qrCodeBgColor);
      const centerColorHex = rgbToHex(qrCodeCenterColor);
      const edgeColorHex = rgbToHex(qrCodeEdgeColor);

      const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nDescription: ${eventDescription}`;

      const qr = new QRCode({
        content: qrCodeData,
        padding: 4,
        width: 256,
        height: 256,
        color: edgeColorHex,
        background: bgColorHex,
        xmlDeclaration: false,
      });

      let svg = qr.svg();

      // Insert the gradient in <defs>
      svg = svg.replace(
        /<svg([^>]*)>/,
        `<svg$1>
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
          </radialGradient>
        </defs>`
      );

      // Apply the gradient directly to QR code squares
      svg = svg.replace(
        /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
        (match, group1, group2) => {
          const isBoundingRect = /x="0".*y="0"/.test(group1);
          return isBoundingRect
            ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
            : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        }
      );

      // Convert SVG to PNG using sharp
      const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

      return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder: "qr_codes",
            public_id: `${firstName}_${lastName}_qr`,
            overwrite: true,
            format: "png",
          },
          async (error, result) => {
            if (error) {
              console.error("Cloudinary Upload Error:", error);
              reject(error);
              return;
            }

            const qrCodeUrl = result?.secure_url;

            try {
              const newGuest = new Guest({
                firstName,
                lastName,
                email,
                phone,
                qrCode: qrCodeUrl,
                qrCodeBgColor,
                qrCodeCenterColor,
                qrCodeEdgeColor,
                imported: true,
                eventId,
              });

              await newGuest.save();

              // Send email with QR Code
              const emailContent = `
              <h2>Welcome to ${eventName}!</h2>
              <p>Dear ${firstName},</p>
              <p>We are delighted to invite you to <strong>${eventName}</strong>. </p>

              <h3>Event Details:</h3>
              <p><strong>Date:</strong> ${eventDate}</p>
              <p><strong>Location:</strong> ${event.location}</p>
              <p><strong>Description:</strong> ${event.description}</p>

              <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
              <img src="${qrCodeUrl}" alt="QR Code" />

              <p>See you at ${eventName}!</p>
              `;

              await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
              resolve({ email, success: true });
            } catch (saveError) {
              console.error("Error saving guest:", saveError);
              reject(saveError);
            }
          }
        ).end(pngBuffer);
      });
    });

    // Wait for all guests to be processed before sending the response
    const results = await Promise.allSettled(guestPromises);

    const successCount = results.filter(
      (result) => result.status === "fulfilled"
    ).length-1;

    res.status(201).json({
      message: `${successCount} guests imported successfully`,
      errors: results
        .filter((result) => result.status === "rejected")
        .map((error) => error.reason),
    });
  } catch (error) {
    console.error("Error processing imported guests:", error);
    res.status(500).json({ message: "Error processing imported guests", error });
  }
};

export const updateGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // const { firstName, lastName, email, phone, eventId } = req.body;

    // Validate the input
    const validateGuest = updateGuestSchema.validate(req.body, option);
    if (validateGuest.error) {
      res.status(400).json({ Error: validateGuest.error.details[0].message });
      return;
    }

    // Find the guest by ID
    const guest = await Guest.findById(id);
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // Get the event details for QR code info
    const event = await Event.findById(guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const eventDate = event.date;
    const eventLocation = event.location;
    const eventDescription = event.description;

    // ✅ Update the guest and get the updated record
    const updatedGuest = await Guest.findByIdAndUpdate(id, req.body, {
      new: true, // Return updated guest
    });

    if (!updatedGuest) {
      res.status(404).json({ message: "Guest not found after update" });
      return;
    }

    // ✅ Use updated values for QR code, fallback to existing values if not updated
    const updatedFirstName = updatedGuest.firstName;
    const updatedLastName = updatedGuest.lastName;

    const qrCodeData = `First Name: ${updatedFirstName}\nLast Name: ${updatedLastName}\nEmail: ${updatedGuest.email}\nPhone: ${updatedGuest.phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nEvent Description: ${eventDescription}`;

    // ✅ Generate SVG QR Code
    const qr = new QRCode({
      content: qrCodeData,
      padding: 4,
      width: 256,
      height: 256,
      color: rgbToHex(updatedGuest.qrCodeEdgeColor),
      background: rgbToHex(updatedGuest.qrCodeBgColor),
      xmlDeclaration: false,
    });

    let svg = qr.svg();

    // ✅ Insert the gradient in <defs>
    svg = svg.replace(
      /<svg([^>]*)>/,
      `<svg$1>
      <defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="${rgbToHex(
            updatedGuest.qrCodeCenterColor
          )}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${rgbToHex(
            updatedGuest.qrCodeEdgeColor
          )}" stop-opacity="1"/>
        </radialGradient>
      </defs>`
    );

    // ✅ Apply gradient to QR squares
    svg = svg.replace(
      /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
      (match, group1, group2) => {
        const isBoundingRect = /x="0".*y="0"/.test(group1);
        return isBoundingRect
          ? `<rect${group1}style="fill:${rgbToHex(
              updatedGuest.qrCodeBgColor
            )};${group2}"/>`
          : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
      }
    );

    // ✅ Convert SVG to PNG using sharp
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // ✅ Upload PNG to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload_stream(
      {
        folder: "qr_codes",
        public_id: `${updatedFirstName}_${updatedLastName}_qr`, // ✅ Updated names for file
        overwrite: true,
        format: "png",
      },
      async (error, result) => {
        if (error) {
          console.error("Cloudinary Upload Error:", error);
          res.status(500).json({ message: "Error uploading QR code", error });
          return;
        }

        const qrCodeUrl = result?.secure_url;

        // ✅ Update guest with new QR Code URL
        updatedGuest.qrCode = qrCodeUrl ?? updatedGuest.qrCode;
        const email = updatedGuest.email;


        try {
          await updatedGuest.save();

          // ✅ Send email notification with updated QR Code
          const emailContent = `
            <h2>Your Event QR Code Has Been Updated</h2>
            <p>Dear ${updatedFirstName},</p>
            <p>Your QR code for <strong>${eventName}</strong> has been updated.</p>

            <h3>Event Details:</h3>
            <p><strong>Date:</strong> ${eventDate}</p>
            <p><strong>Location:</strong> ${eventLocation}</p>
            <p><strong>Description:</strong> ${eventDescription}</p>

            <p>Please find your updated QR code below:</p>
            <img src="${qrCodeUrl}" alt="QR Code" />

            <p>Thank you, and we look forward to seeing you at ${eventName}!</p>
          `;

          await sendEmail(email, `Your Updated QR Code for ${eventName}`, emailContent)
            .then(() => console.log("Email sent successfully!"))
            .catch((error) => console.error("Error sending email:", error));

          res.status(200).json({
            message: "Guest updated successfully and notified via email",
            guest: updatedGuest,
          });
        } catch (saveError) {
          console.error("Error saving updated guest:", saveError);
          res.status(500).json({ message: "Error saving guest", saveError });
        }
      }
    );

    uploadResponse.end(pngBuffer); 
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error updating guest", error });
  }
};


export const downloadQRCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const guest = await Guest.findById(id);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }


    const event = await Event.findById(guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name; 
    const eventDate = event.date; 
    const eventLocation = event.location;
    const eventDescription = event.description;

    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

    const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEmail: ${guest.email}\nPhone: ${guest.phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nEvent Description: ${eventDescription}`;

    const qr = new QRCode({
      content: qrCodeData,
      padding: 4,
      width: 256,
      height: 256,
      color: edgeColorHex,
      background: bgColorHex,
      xmlDeclaration: false,
    });

    let svg = qr.svg();

    // ✅ Inject Gradient into the SVG
    svg = svg.replace(
      "<svg ",
      `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style="stop-color:${centerColorHex}; stop-opacity:1" />
          <stop offset="100%" style="stop-color:${edgeColorHex}; stop-opacity:1" />
        </radialGradient>
      </defs>
      `
    );

    // ✅ Replace foreground color with gradient
    svg = svg.replace(/fill="[^"]+"/g, 'fill="url(#grad1)"');

    // ✅ Convert SVG to Buffer (PNG format)
    const svgBuffer = Buffer.from(svg);
    const sharp = await import("sharp");
    const pngBuffer = await sharp.default(svgBuffer).png().toBuffer();

    // ✅ Upload QR code to Cloudinary
    const uploadResponse: UploadApiResponse = await new Promise(
      (resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { resource_type: "image", folder: "qrcodes" },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result as UploadApiResponse); 
            }
          }
        );

        const readableStream = new stream.PassThrough();
        readableStream.end(pngBuffer);
        readableStream.pipe(uploadStream);
      }
    );

    if (!uploadResponse.secure_url) {
      res.status(500).json({ message: "Error uploading QR code" });
      return;
    }

    // ✅ Send Cloudinary URL for download
    res.json({ downloadUrl: uploadResponse.secure_url });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error downloading QR code" });
  }
};

export const downloadAllQRCodes = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const guests = await Guest.find({ eventId });

    if (guests.length === 0) {
      res.status(404).json({ message: "No guests found" });
      return;
    }

    // Create an in-memory ZIP archive
    const archive = archiver("zip", { zlib: { level: 9 } });
    const zipBufferStream = new stream.PassThrough();
    archive.pipe(zipBufferStream);

    // Generate and append QR codes to ZIP
    for (const guest of guests) {

    const event = await Event.findById(guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
      const eventDate = event.date;
      const eventLocation = event.location;
      const eventDescription = event.description;

    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

    // ✅ Generate QR Code Data
    const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEmail: ${guest.email}\nPhone: ${guest.phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nEvent Description: ${eventDescription}`;
    
    // ✅ Generate SVG QR Code with Gradient
    const qr = new QRCode({
      content: qrCodeData,
      padding: 4,
      width: 256,
      height: 256,
      color: edgeColorHex,
      background: bgColorHex,
      xmlDeclaration: false,
    });

let svg = qr.svg();

      // Insert the gradient in <defs>
      svg = svg.replace(
        /<svg([^>]*)>/,
        `<svg$1>
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
          </radialGradient>
        </defs>`
      );

      // Apply the gradient directly to QR code squares
      svg = svg.replace(
        /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
        (match, group1, group2) => {
          const isBoundingRect = /x="0".*y="0"/.test(group1);
          return isBoundingRect
            ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
            : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        }
      );

    // ✅ Convert SVG to Buffer (PNG format)
    const svgBuffer = Buffer.from(svg);
    const sharp = await import("sharp");
    const pngBuffer = await sharp.default(svgBuffer).png().toBuffer();

      archive.append(pngBuffer, {
        name: `${guest.firstName}-${guest.lastName}.png`,
      });
    }

    // Finalize archive
    await archive.finalize();

    // Upload the ZIP to Cloudinary
    const uploadPromise = new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: "raw", folder: "qrcodes", format: "zip" },
        (error, result) => {
          if (error) {
            console.error("Cloudinary upload error:", error);
            reject(error);
          } else if (result && result.secure_url) {
            resolve(result.secure_url);
          } else {
            reject(new Error("Invalid Cloudinary response"));
          }
        }
      );
      zipBufferStream.pipe(uploadStream);
    });

    // Get the Cloudinary ZIP file URL
    const zipDownloadLink = await uploadPromise;

    // Return the ZIP download link
    res.status(200).json({ zipDownloadLink });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error generating ZIP file" });
  }
};

// **Get All Guests for an Event**
export const getGuestsByEvent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const guests = await Guest.find({ eventId: eventId });
    if (guests.length == 0) {
      res.status(400).json({ message: "No events found" });
      return;
    }

    res.status(200).json({
      message: "Successfully fetched all guests for the events",
      guests,
    });
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
    const { id } = req.params;
    const guest = await Guest.findById(id);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
    }

    res.status(200).json({ message: "Successfully fetched guest", guest });
  } catch (error) {
    res.status(500).json({ message: "Error fetching guest" });
  }
};


export const deleteGuestById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    // Find the guest before deleting
    const guest = await Guest.findById(id);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // Extract the Cloudinary public ID from the QR code URL
    if (guest.qrCode) {
      const publicId = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)?.[1];
      if (publicId) {
        await cloudinary.uploader.destroy(`qr_codes/${publicId}`);
      }
    }

    // Fully delete guest from database
    await Guest.findByIdAndDelete(id);

    res.status(200).json({ message: "Guest deleted successfully" });
  } catch (error) {
    console.error("Error deleting guest:", error);
    res.status(500).json({ message: "Error deleting guest" });
  }
};

// **Delete Guests by Event ID**
export const deleteGuestsByEvent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;

    // Find all guests associated with the event
    const guests = await Guest.find({ eventId });

    if (guests.length === 0) {
      res.status(404).json({ message: "No guests found for this event" });
      return;
    }

    // Delete all QR codes from Cloudinary in parallel
    const deletionPromises = guests.map(async (guest) => {
      if (guest.qrCode) {
        const publicId = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)?.[1];
        if (publicId) {
          return cloudinary.uploader.destroy(`qr_codes/${publicId}`);
        }
      }
    });

    await Promise.allSettled(deletionPromises);

    // Ensure guests are fully removed from the database
    await Guest.deleteMany({ eventId });

    res.status(200).json({ message: "All guests and their QR codes deleted successfully" });
  } catch (error) {
    console.error("Error deleting guests:", error);
    res.status(500).json({ message: "Error deleting guests" });
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
    if (guest.checkedIn) {
      res.status(400).json({ message: "Guest already checked in" });
      return;
    }

    guest.checkedIn = true;
    guest.status = "checked-in";
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
    // Count total events
    const totalEvents = await Event.countDocuments();

    // Count total guests across all events
    const totalGuests = await Guest.countDocuments();

    // Count checked-in guests across all events
    const checkedInGuests = await Guest.countDocuments({ checkedIn: true });

    // Calculate unused codes
    const unusedCodes = totalGuests - checkedInGuests;

    res.status(200).json({
      totalEvents,
      totalGuests,
      checkedInGuests,
      unusedCodes,
    });
  } catch (error) {
    console.error("Error generating analytics:", error);
    res.status(500).json({ message: "Error generating analytics" });
  }
};

export const generateTempLink = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;

    // Check if the event exists
    const event = await Event.findById(eventId);
    if (!event) {
    res.status(404).json({ message: "Event not found" });
     return;
    }

    // Generate a JWT with event-specific data and expiration (e.g., 12 hours)
    const token = jwt.sign(
      { eventId: eventId, role: "temp", type: "checkin" },
      process.env.JWT_SECRET as string,
      { expiresIn: "72h" }
    );

    // Create a temporary link with the token
    const tempLink = `${process.env.FRONTEND_URL}/guest/${eventId}?token=${token}`;
    res.status(200).json({ tempLink });
  } catch (error) {
    console.error("Error generating temp link:", error);
    res.status(500).json({ message: "Error generating temp link" });
  }
};
