import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
// import QRCode from "qrcode";
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

// **Add a Guest & Generate QR Code**
// export const addGuest = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { firstName, lastName, email, phone, qrCodeColor, eventId } =
//       req.body;

//     // Validate request body (using your existing createGuestSchema)
// const validateGuest = createGuestSchema.validate(req.body, option);
// if (validateGuest.error) {
//   res.status(400).json({ Error: validateGuest.error.details[0].message });
//   return;
// }

//     // Check if guest already exists for this event
//     const existingGuest = await Guest.findOne({ email, eventId });
//     if (existingGuest) {
//       res.status(409).json({ message: "Guest already exists for this event" });
//       return;
//     }

//     // Retrieve event details using eventId
// const event = await Event.findById(eventId);
// if (!event) {
//   res.status(404).json({ message: "Event not found" });
//   return;
// }
// const eventName = event.name;
// const eventDate = event.date;
// const eventLocation = event.location;

//     // Determine the selected QR code color (if provided and allowed; default to "black")
//     const selectedColor = allowedColors.includes(qrCodeColor)
//       ? qrCodeColor
//       : "black";
//     const colorHex = qrColorMap[selectedColor];

//     // Generate a properly formatted QR code data
//     const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}`;

//     // Generate QR code with the selected color
//     const qrCodeDataUrl = await QRCode.toDataURL(qrCodeData, {
//       color: { dark: colorHex, light: "#FFFFFF" },
//     });

//     // Upload the generated QR code image to Cloudinary
//     const uploadResponse = await cloudinary.uploader.upload(qrCodeDataUrl, {
//       folder: "qr_codes",
//       public_id: `${firstName}_${lastName}_qr`,
//       overwrite: true,
//     });

//     // Save guest details along with the Cloudinary URL and chosen color
//     const newGuest = new Guest({
//       firstName,
//       lastName,
//       email,
//       phone,
//       qrCode: uploadResponse.secure_url,
//       qrCodeColor: selectedColor,
//       eventId,
//       eventName,
//       eventDate,
//       imported: false,
//     });
//     await newGuest.save();

//     // Send invitation email
//     const emailContent = `
//       <h2>Welcome to ${eventName}!</h2>
//       <p>Dear ${firstName},</p>
//       <p>We are delighted to invite you to <strong>${eventName}</strong>.</p>
//       <h3>Event Details:</h3>
//       <p><strong>Date:</strong> ${eventDate}</p>
//       <p><strong>Location:</strong> ${eventLocation}</p>
//       <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
//       <img src="${uploadResponse.secure_url}" alt="QR Code" />
//       <p>See you at ${eventName}!</p>
//     `;
//     try {
//       await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
//       console.log("Email sent successfully!");
//     } catch (error) {
//       console.error("Error sending email:", error);
//     }

//     res
//       .status(201)
//       .json({ message: "Guest created successfully", guest: newGuest });
//   } catch (error) {
//     console.error("Error:", error);
//     res.status(500).json({ message: "Error creating guest", error });
//   }
// };

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

    const bgColorHex = rgbToHex(qrCodeBgColor);
    const centerColorHex = rgbToHex(qrCodeCenterColor);
    const edgeColorHex = rgbToHex(qrCodeEdgeColor);

    const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}`;

    // Generate SVG QR Code with a gradient
    const qr = new QRCode({
      content: qrCodeData,
      padding: 4,
      width: 256,
      height: 256,
      color: edgeColorHex, // Default color (will be overridden in SVG)
      background: bgColorHex,
      xmlDeclaration: false, // Remove XML declaration for cleaner output
    });

    let svg = qr.svg();

    // Inject Gradient into the SVG
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

    // Replace all QR foreground elements with the gradient fill
    svg = svg.replace(/fill="[^"]+"/g, 'fill="url(#grad1)"');

    // Upload to Cloudinary (Convert SVG to Base64 first)
    const uploadResponse = await cloudinary.uploader.upload(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      {
        folder: "qr_codes",
        public_id: `${firstName}_${lastName}_qr`,
        overwrite: true,
      }
    );

    // Save guest with QR Code URL
    const newGuest = new Guest({
      firstName,
      lastName,
      email,
      phone,
      qrCode: uploadResponse.secure_url,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
      eventId,
    });

    await newGuest.save();

    // ✅ Send email using Zoho or Brevo
    const emailContent = `
<h2>Welcome to ${eventName}!</h2>
<p>Dear ${firstName},</p>
<p>We are delighted to invite you to <strong>${eventName}</strong>. </p>

<h3>Event Details:</h3>
<p><strong>Date:</strong> ${eventDate}</p>
<p><strong>Location:</strong> ${event.location}</p>

<p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
<img src="${uploadResponse.secure_url}" alt="QR Code" />

<p>See you at ${eventName}!</p>
`;

    try {
      await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
      console.log("Email sent successfully!");
    } catch (error) {
      console.error("Error sending email:", error);
    }

    res
      .status(201)
      .json({ message: "Guest created successfully", guest: newGuest });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error creating guest", error });
  }
};

// **Update Guest **
// export const updateGuest = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const { firstName, lastName, email, phone, eventId } = req.body;

//     // Validate input
//     const validateGuest = updateGuestSchema.validate(req.body);
//     if (validateGuest.error) {
//       res.status(400).json({ error: validateGuest.error.details[0].message });
//       return;
//     }

//     // Find the guest by ID
//     const guest = await Guest.findById(id);
//     if (!guest) {
//       res.status(404).json({ message: "Guest not found" });
//       return;
//     }

//     // Extract old QR code public ID from Cloudinary URL
//     if (guest.qrCode) {
//       const oldPublicId = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)?.[1]; // Correct extraction
//       if (oldPublicId) {
//         const deleteResponse = await cloudinary.uploader.destroy(
//           `qr_codes/${oldPublicId}`
//         );
//         console.log("Cloudinary delete response:", deleteResponse); // Debugging
//       }
//     }

//     // Update guest fields
//     guest.firstName = firstName || guest.firstName;
//     guest.lastName = lastName || guest.lastName;
//     guest.email = email || guest.email;
//     guest.phone = phone || guest.phone;
//     guest.eventId = eventId || guest.eventId;

//     // Generate a new QR code with updated info
//     /// Retrieve event details using eventId
//     const event = await Event.findById(eventId);
//     if (!event) {
//       res.status(404).json({ message: "Event not found" });
//       return;
//     }

//     const eventName = event.name; // Get event name
//     const eventDate = event.date; // Get event date

//     // Generate a properly formatted QR code data
//     const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}`;
//     const qrCodeDataUrl = await QRCode.toDataURL(qrCodeData);

//     // Upload new QR code to Cloudinary
//     const uploadResponse = await cloudinary.uploader.upload(qrCodeDataUrl, {
//       folder: "qr_codes",
//       public_id: `${guest.firstName}_${guest.lastName}_qr`,
//       overwrite: true, // Ensure old QR code is replaced
//     });

//     // Save new QR code URL in database
//     guest.qrCode = uploadResponse.secure_url;

//     // Save updated guest details
//     await guest.save();

//     res.status(200).json({ message: "Guest updated successfully", guest });
//   } catch (error) {
//     res.status(500).json({ message: "Error updating guest", error });
//   }
// };

export const updateGuest = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
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

    // ✅ Validate input
    const validateGuest = updateGuestSchema.validate(req.body);
    if (validateGuest.error) {
      res.status(400).json({ error: validateGuest.error.details[0].message });
      return;
    }

    // ✅ Find guest by ID
    const guest = await Guest.findById(id);
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // ✅ Delete old QR code from Cloudinary (if it exists)
    if (guest.qrCode) {
      const oldPublicId = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)?.[1];
      if (oldPublicId) {
        await cloudinary.uploader.destroy(`qr_codes/${oldPublicId}`);
      }
    }

    // ✅ Retrieve event details
    const event = await Event.findById(eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const eventDate = event.date;
    const eventLocation = event.location;

    // ✅ Convert RGB to HEX (if new colors provided)
    const bgColorHex = qrCodeBgColor
      ? rgbToHex(qrCodeBgColor)
      : guest.qrCodeBgColor;
    const centerColorHex = qrCodeCenterColor
      ? rgbToHex(qrCodeCenterColor)
      : guest.qrCodeCenterColor;
    const edgeColorHex = qrCodeEdgeColor
      ? rgbToHex(qrCodeEdgeColor)
      : guest.qrCodeEdgeColor;

    // ✅ Generate new QR code data
    const qrCodeData = `First Name: ${
      firstName || guest.firstName
    }\nLast Name: ${lastName || guest.lastName}\nEmail: ${
      email || guest.email
    }\nPhone: ${
      phone || guest.phone
    }\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}`;

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

    // ✅ Inject Gradient into SVG
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

    // ✅ Upload new QR code to Cloudinary
    const uploadResponse: { secure_url?: string } = await new Promise(
      (resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { resource_type: "image", folder: "qr_codes" },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result as { secure_url: string }); // ✅ Ensure TypeScript knows the response structure
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

    // ✅ Update guest details
    guest.firstName = firstName || guest.firstName;
    guest.lastName = lastName || guest.lastName;
    guest.email = email || guest.email;
    guest.phone = phone || guest.phone;
    guest.eventId = eventId || guest.eventId;
    guest.qrCode = uploadResponse.secure_url;
    guest.qrCodeBgColor = bgColorHex;
    guest.qrCodeCenterColor = centerColorHex;
    guest.qrCodeEdgeColor = edgeColorHex;

    // ✅ Save updated guest
    await guest.save();

    res.status(200).json({ message: "Guest updated successfully", guest });
  } catch (error) {
    console.error("Error updating guest:", error);
    res.status(500).json({ message: "Error updating guest", error });
  }
};

// ✅ Process Guests and Save to Database
// const processGuests = async (
//   guests: Array<{
//     firstName: string;
//     lastName: string;
//     email: string;
//     phone: string;
//     eventId: string;
//   }>,
//   res: Response
// ): Promise<void> => {
//   try {
//     for (const guest of guests) {
//       const { firstName, lastName, email, phone, eventId } = guest;

//       // Skip if email is missing
//       if (!email) continue;

//       // Check if guest already exists
//       const existingGuest = await Guest.findOne({ email, eventId });
//       if (existingGuest) continue;

//       // Retrieve event details
//       const event = await Event.findById(eventId);
//       if (!event) continue;

//       const eventName = event.name;
//       const eventDate = event.date;
//       const EventLocation = event.location;

//       // Generate a properly formatted QR code data
//       const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEmail: ${guest.email}\nPhone: ${guest.phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${EventLocation}`;
//       const qrCodeDataUrl = await QRCode.toDataURL(qrCodeData);

//       // ✅ Upload QR Code to Cloudinary
//       const uploadResponse = await cloudinary.uploader.upload(qrCodeDataUrl, {
//         folder: "qr_codes",
//         public_id: `${guest.firstName}_${guest.lastName}_qr`,
//         overwrite: true,
//       });

//       // ✅ Save Guest to Database
//       const newGuest = new Guest({
//         firstName: guest.firstName,
//         lastName: guest.lastName,
//         email: guest.email,
//         phone: guest.phone,
//         qrCode: uploadResponse.secure_url,
//         eventId: guest.eventId,
//         eventName: eventName, // Storing event name separately
//         eventDate: eventDate,
//         imported: true, // Set imported to true since the guest is being added from a file
//       });

//       await newGuest.save();

//       // ✅ Send email using Zoho or Brevo
//   const emailContent = `
// <h2>Welcome to ${eventName}!</h2>
// <p>Dear ${firstName},</p>
// <p>We are delighted to invite you to <strong>${eventName}</strong>. </p>

// <h3>Event Details:</h3>
// <p><strong>Date:</strong> ${eventDate}</p>
// <p><strong>Location:</strong> ${event.location}</p>

// <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
// <img src="${uploadResponse.secure_url}" alt="QR Code" />

// <p>See you at ${eventName}!</p>
// `;

//   await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
// }

//     res.status(201).json({ message: "Guests imported successfully" });
//   } catch (error) {
//     console.error("Error saving guests:", error);
//     res.status(500).json({ message: "Error processing guests" });
//   }
// };

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
    for (const guest of guests) {
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

      if (!email) continue;

      const existingGuest = await Guest.findOne({ email, eventId });
      if (existingGuest) continue;

      const event = await Event.findById(eventId);
      if (!event) continue;

      const eventName = event.name;
      const eventDate = event.date;
      const eventLocation = event.location;

      const bgColorHex = rgbToHex(qrCodeBgColor);
      const centerColorHex = rgbToHex(qrCodeCenterColor);
      const edgeColorHex = rgbToHex(qrCodeEdgeColor);

      const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}`;

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
      svg = svg.replace(/fill="[^"]+"/g, 'fill="url(#grad1)"');

      const uploadResponse = await cloudinary.uploader.upload(
        `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        {
          folder: "qr_codes",
          public_id: `${firstName}_${lastName}_qr`,
          overwrite: true,
        }
      );

      const newGuest = new Guest({
        firstName,
        lastName,
        email,
        phone,
        qrCode: uploadResponse.secure_url,
        qrCodeBgColor,
        qrCodeCenterColor,
        qrCodeEdgeColor,
        eventId,
        eventName,
        eventDate,
        imported: true,
      });

      await newGuest.save();

      const emailContent = `
      <h2>Welcome to ${eventName}!</h2>
      <p>Dear ${firstName},</p>
      <p>We are delighted to invite you to <strong>${eventName}</strong>.</p>
      <h3>Event Details:</h3>
      <p><strong>Date:</strong> ${eventDate}</p>
      <p><strong>Location:</strong> ${eventLocation}</p>
      <p>Your QR code for the event is attached below.</p>
      <img src="${uploadResponse.secure_url}" alt="QR Code" />
      <p>See you at ${eventName}!</p>
      `;

      await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
    }
    res.status(201).json({ message: "Guests imported successfully" });
  } catch (error) {
    console.error("Error saving guests:", error);
    res.status(500).json({ message: "Error processing guests" });
  }
};

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

// ✅ Import Guests from CSV/Excel and delete from Cloudinary
// export const importGuests = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     if (!req.file) {
//       res.status(400).json({ message: "No file uploaded" });
//       return;
//     }

//     // ✅ Upload CSV/Excel as "raw" file type in Cloudinary
//     const uploadResponse = await cloudinary.uploader.upload(req.file.path, {
//       resource_type: "raw",
//       folder: "uploads",
//     });

//     const fileUrl = uploadResponse.secure_url; // ✅ Get the file URL
//     const publicId = uploadResponse.public_id; // ✅ Get the correct public_id

//     const guests: any[] = [];

//     if (req.file.mimetype === "text/csv") {
//       // ✅ Fetch CSV file correctly
//       const fetchResponse = await fetch(fileUrl);
//       const csvData = await fetchResponse.text();

//       fastcsv
//         .parseString(csvData, { headers: true })
//         .on("data", (row: any) => guests.push(row))
//         .on("end", async () => {
//           try {
//             await processGuests(guests, res);
//           } finally {
//             await cloudinary.uploader.destroy(publicId); // ✅ Ensure deletion happens
//           }
//         })
//         .on("error", async (err: Error) => {
//           console.error("CSV parsing error:", err);
//           await cloudinary.uploader.destroy(publicId); // ✅ Delete file in case of error
//           res.status(500).json({ message: "Error parsing CSV file" });
//         });
//     } else if (req.file.mimetype.includes("spreadsheet")) {
//       // ✅ Fetch Excel file correctly
//       const fetchResponse = await fetch(fileUrl);
//       const arrayBuffer = await fetchResponse.arrayBuffer();
//       const excelData = Buffer.from(arrayBuffer);

//       const workbook = xlsx.read(excelData);
//       const sheetName = workbook.SheetNames[0];
//       const sheet = workbook.Sheets[sheetName];
//       const data: Array<{ [key: string]: any }> =
//         xlsx.utils.sheet_to_json(sheet);

//       guests.push(...data);

//       try {
//         await processGuests(guests, res);
//       } finally {
//         await cloudinary.uploader.destroy(publicId); // ✅ Ensure deletion happens
//       }
//     } else {
//       await cloudinary.uploader.destroy(publicId); // ✅ Delete file if invalid type
//       res.status(400).json({ message: "Invalid file type" });
//     }
//   } catch (error) {
//     console.error("Error importing guests:", error);
//     res.status(500).json({ message: "Error importing guests" });
//   }
// };

// **Download QR Code as PNG (Single)**
// export const downloadQRCode = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { id } = req.params;
//     const guest = await Guest.findById(id);

//     if (!guest) {
//       res.status(404).json({ message: "Guest not found" });
//       return;
//     }

//     // ✅ Generate QR Code in-memory
//     const qrCodeBuffer = await QRCode.toBuffer(guest.qrCode);

//     // ✅ Upload QR code to Cloudinary
//     const uploadResponse = await cloudinary.uploader.upload_stream(
//       { resource_type: "image", folder: "qrcodes" },
//       async (error, result) => {
//         if (error) {
//           console.error("Cloudinary upload error:", error);
//           return res.status(500).json({ message: "Error uploading QR code" });
//         } else if (result) {
//           // ✅ Send Cloudinary URL for download
//           res.json({ downloadUrl: result.secure_url });
//         }
//       }
//     );

//     const readableStream = new stream.PassThrough();
//     readableStream.end(qrCodeBuffer);
//     readableStream.pipe(uploadResponse);
//   } catch (error) {
//     console.error("Error:", error);
//     res.status(500).json({ message: "Error downloading QR code" });
//   }
// };

// **Download All QR Codes as ZIP**
// export const downloadAllQRCodes = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { eventId } = req.params;
//     const guests = await Guest.find({ eventId });

//     if (guests.length === 0) {
//       res.status(404).json({ message: "No guests found" });
//       return;
//     }

//     // Create an in-memory ZIP archive
//     const archive = archiver("zip", { zlib: { level: 9 } });
//     const zipBufferStream = new stream.PassThrough();

//     archive.pipe(zipBufferStream);

//     // Generate and append QR codes to ZIP
//     for (const guest of guests) {
//       const qrCodeBuffer = await QRCode.toBuffer(guest.qrCode);
//       archive.append(qrCodeBuffer, {
//         name: `${guest.firstName}-${guest.lastName}.png`,
//       });
//     }

//     // Finalize archive
//     await archive.finalize();

//     // Upload the ZIP to Cloudinary
//     const uploadPromise = new Promise<string>((resolve, reject) => {
//       const uploadStream = cloudinary.uploader.upload_stream(
//         { resource_type: "raw", folder: "qrcodes", format: "zip" },
//         (error, result) => {
//           if (error) {
//             console.error("Cloudinary upload error:", error);
//             reject(error);
//           } else if (result) {
//             resolve(result.secure_url);
//           }
//         }
//       );

//       zipBufferStream.pipe(uploadStream);
//     });

//     // Get the Cloudinary ZIP file URL
//     const zipDownloadLink = await uploadPromise;

//     // Return the ZIP download link
//     res.status(200).json({ zipDownloadLink });
//   } catch (error) {
//     console.error("Error:", error);
//     res.status(500).json({ message: "Error generating ZIP file" });
//   }
// };

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

    // ✅ Fetch Event Details
    const event = await Event.findById(guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name; // ✅ Extract event name
    const eventDate = event.date; // ✅ Extract event date
    const eventLocation = event.location;

    // ✅ Convert RGB to HEX
    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

    // ✅ Generate QR Code Data
    const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEmail: ${guest.email}\nPhone: ${guest.phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}`;

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
              resolve(result as UploadApiResponse); // ✅ Explicitly cast to correct type
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
      const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEmail: ${guest.email}\nPhone: ${guest.phone}\nEvent ID: ${eventId}`;

      // ✅ Generate QR Code as SVG using qrcode-svg
      const qr = new QRCode({
        content: qrCodeData,
        padding: 4,
        width: 256,
        height: 256,
      });

      const qrSvg = qr.svg(); // Get the SVG QR code as a string

      // ✅ Convert SVG to PNG Buffer using sharp
      const pngBuffer = await sharp(Buffer.from(qrSvg)).png().toBuffer();

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

// **Delete Single Guest by ID**
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

    // Delete guest from database
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

    // Delete all QR codes from Cloudinary
    for (const guest of guests) {
      if (guest.qrCode) {
        const publicId = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)?.[1];
        if (publicId) {
          await cloudinary.uploader.destroy(`qr_codes/${publicId}`);
        }
      }
    }

    // Delete all guests from database
    await Guest.deleteMany({ eventId });

    res
      .status(200)
      .json({ message: "All guests and their QR codes deleted successfully" });
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
