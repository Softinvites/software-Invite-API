import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
import QRCode from "qrcode-svg";
import archiver from "archiver";
import xlsx from "xlsx";
import * as fastcsv from "fast-csv";
import { cloudinary } from "../library/helpers/uploadImage";
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";
import stream from "stream";
import fetch from "node-fetch";
import { sendEmail } from "../library/helpers/emailService";
import { rgbToHex } from "../utils/colorUtils";
import sharp from "sharp";
import { PassThrough } from 'stream';
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

    const bgColorHex = rgbToHex(qrCodeBgColor);
    const centerColorHex = rgbToHex(qrCodeCenterColor);
    const edgeColorHex = rgbToHex(qrCodeEdgeColor);

  // Create guest without qrCode and qrCodeData
const newGuest = new Guest({
  firstName,
  lastName,
  qrCodeBgColor,
  qrCodeCenterColor,
  qrCodeEdgeColor,
  eventId,
  ...(phone && { phone }),
  ...(email && { email }),
});

const savedGuest = await newGuest.save(); // Save so we can use the ID

// Generate QR code data
const guestId = savedGuest._id.toString();
const qrCodeData = guestId;

// Generate QR code
const qr = new QRCode({
  content: qrCodeData,
  padding: 5,
  width: 512,
  height: 512,
  color: edgeColorHex,
  background: bgColorHex,
  xmlDeclaration: false,
});

let svg = qr.svg();

// Insert gradient into the SVG
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

// Adjust the QR code style
svg = svg.replace(
  /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
  (match, group1, group2) => {
    const isBoundingRect = /x="0".*y="0"/.test(group1);
    return isBoundingRect
      ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
      : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
  }
);

// Convert to PNG
const pngBuffer = await sharp(Buffer.from(svg))
  .resize(512, 512, { fit: "contain" })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

// Upload to Cloudinary
const qrCodeUrl = await new Promise<string>((resolve, reject) => {
  const uploadStream = cloudinary.uploader.upload_stream(
    {
      folder: "qr_codes",
      public_id: `${firstName}_${lastName}_qr`,
      overwrite: true,
      format: "png",
    },
    (error, result) => {
      if (error || !result?.secure_url) {
        return reject(error);
      }
      resolve(result.secure_url);
    }
  );

  uploadStream.end(pngBuffer);
});

// Update the saved guest with qrCode and qrCodeData
savedGuest.qrCode = qrCodeUrl;
savedGuest.qrCodeData = qrCodeData;

// Save the guest with QR code data
await savedGuest.save();

    

    if (email) {
      const emailContent = `
        <h2>Welcome to ${eventName}!</h2>
        <p>Dear ${firstName},</p>
        <p>We are delighted to invite you to <strong>${eventName}</strong>.</p>
        <h3>Event Details:</h3>
        <p><strong>Date:</strong> ${eventDate}</p>
        <p><strong>Location:</strong> ${eventLocation}</p>
        <p><strong>Description:</strong> ${event.description}</p>
        <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
        <img src=\"${qrCodeUrl}\" alt=\"QR Code\" />
        <p>See you at ${eventName}!</p>
      `;

      try {
        await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
        console.log("Email sent successfully!");
      } catch (emailError) {
        console.error("Error sending email:", emailError);
      }
    }

    res.status(201).json({ message: "Guest created successfully", guest: savedGuest });

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
    email?: string;
    phone?: string;
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

      const event = await Event.findById(eventId);
      if (!event) return null;

      const eventName = event.name;
      const eventDate = event.date;
      const eventLocation = event.location;

      const bgColorHex = rgbToHex(qrCodeBgColor);
      const centerColorHex = rgbToHex(qrCodeCenterColor);
      const edgeColorHex = rgbToHex(qrCodeEdgeColor);

      // Create guest without qrCode and qrCodeData
      const newGuest = new Guest({
        firstName,
        lastName,
        qrCodeBgColor,
        qrCodeCenterColor,
        qrCodeEdgeColor,
        eventId,
        ...(phone && { phone }),
        ...(email && { email }),
      });

      const savedGuest = await newGuest.save(); // Save to get guestId

      // Generate QR code data with guestId
      const guestId = savedGuest._id.toString();
      const qrCodeData = guestId;

      // Generate QR code
      const qr = new QRCode({
        content: qrCodeData,
        padding: 10,
        width: 512,
        height: 512,
        color: edgeColorHex,
        background: bgColorHex,
        xmlDeclaration: false,
      });

      let svg = qr.svg();

      // Insert gradient into the SVG
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

      // Adjust the QR code style
      svg = svg.replace(
        /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
        (match, group1, group2) => {
          const isBoundingRect = /x="0".*y="0"/.test(group1);
          return isBoundingRect
            ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
            : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        }
      );

      // Convert to PNG
      const pngBuffer = await sharp(Buffer.from(svg))
        .resize(512, 512, { fit: "contain" })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();

      // Upload to Cloudinary
      const qrCodeUrl = await new Promise<string>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "qr_codes",
            public_id: `${firstName}_${lastName}_qr`,
            overwrite: true,
            format: "png",
          },
          (error, result) => {
            if (error || !result?.secure_url) {
              return reject(error);
            }
            resolve(result.secure_url);
          }
        );

        uploadStream.end(pngBuffer);
      });

      // Update the saved guest with qrCode and qrCodeData
      savedGuest.qrCode = qrCodeUrl;
      savedGuest.qrCodeData = qrCodeData;

      // Save the guest with QR code data
      await savedGuest.save();

      if (email) {
        const emailContent = `
          <h2>Welcome to ${eventName}!</h2>
          <p>Dear ${firstName},</p>
          <p>We are delighted to invite you to <strong>${eventName}</strong>.</p>
          <h3>Event Details:</h3>
          <p><strong>Date:</strong> ${eventDate}</p>
          <p><strong>Location:</strong> ${eventLocation}</p>
          <p><strong>Description:</strong> ${event.description}</p>
          <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
          <img src="${qrCodeUrl}" alt="QR Code" />
          <p>See you at ${eventName}!</p>
        `;

        try {
          await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
          console.log("Email sent successfully!");
        } catch (emailError) {
          console.error("Error sending email:", emailError);
        }
      }

      return { email, success: true };
    });

    const results = await Promise.allSettled(guestPromises);

    const successCount = results.filter((r) => r.status === "fulfilled").length-1;

    res.status(201).json({
      message: `${successCount} guests imported successfully`,
      errors: results
        .filter((r) => r.status === "rejected")
        .map((err) => err.reason),
    });
  } catch (error) {
    console.error("Error processing imported guests:", error);
    res.status(500).json({ message: "Error processing imported guests", error });
  }
};

export const updateGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { email, firstName, lastName, eventId, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor } = req.body;

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

    // Update guest details
    guest.firstName = firstName || guest.firstName;
    guest.lastName = lastName || guest.lastName;
    guest.email = email || guest.email;
    guest.eventId = eventId || guest.eventId;
    guest.qrCodeBgColor = qrCodeBgColor || guest.qrCodeBgColor;
    guest.qrCodeCenterColor = qrCodeCenterColor || guest.qrCodeCenterColor;
    guest.qrCodeEdgeColor = qrCodeEdgeColor || guest.qrCodeEdgeColor;

    const updatedGuest = await guest.save();

    // Generate QR code data using guestId
    const guestId = updatedGuest._id.toString();
    const qrCodeData = guestId;

    // Generate QR code
    const qr = new QRCode({
      content: qrCodeData,
      padding: 5,
      width: 512,
      height: 512,
      color: qrCodeEdgeColor,
      background: qrCodeBgColor,
      xmlDeclaration: false,
    });

    let svg = qr.svg();

    // Insert gradient into the SVG
    svg = svg.replace(
      /<svg([^>]*)>/,
      `<svg$1>
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="${qrCodeCenterColor}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${qrCodeEdgeColor}" stop-opacity="1"/>
          </radialGradient>
        </defs>`
    );

    // Adjust the QR code style
    svg = svg.replace(
      /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
      (match, group1, group2) => {
        const isBoundingRect = /x="0".*y="0"/.test(group1);
        return isBoundingRect
          ? `<rect${group1}style="fill:${qrCodeBgColor};${group2}"/>`
          : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
      }
    );

    const pngBuffer = await sharp(Buffer.from(svg))
      .resize(512, 512, { fit: 'contain' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    // Upload PNG to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload_stream(
      {
        folder: "qr_codes",
        public_id: `${firstName}_${lastName}_qr`,
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

        // Update guest with new QR Code URL
        updatedGuest.qrCode = qrCodeUrl ?? updatedGuest.qrCode;
        const guestEmail = updatedGuest.email;

        try {
          await updatedGuest.save();

          // Send email notification with updated QR Code
          if (guestEmail) {
            const emailContent = `
              <h2>Your Event QR Code Has Been Updated</h2>
              <p>Dear ${firstName},</p>
              <p>Your QR code for the event has been updated.</p>
              <p>Please find your updated QR code below:</p>
              <img src="${qrCodeUrl}" alt="QR Code" />
              <p>Thank you, and we look forward to seeing you at the event!</p>
            `;

            await sendEmail(
              guestEmail,
              `Your Updated QR Code`,
              emailContent
            );
          }

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
      res.status(404).json({ message: 'Guest not found' });
      return;
    }

    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

    const qr = new QRCode({
      content: guest._id.toString(),
      padding: 5,
      width: 512,
      height: 512,
      color: edgeColorHex,
      background: bgColorHex,
      xmlDeclaration: false,
    });

    let svg = qr.svg();

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

    svg = svg.replace(
      /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
      (match, group1, group2) => {
        const isBoundingRect = /x="0".*y="0"/.test(group1);
        return isBoundingRect
          ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
          : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
      }
    );

    const pngBuffer = await sharp(Buffer.from(svg))
      .resize(512, 512, { fit: 'contain' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="qr-${guest.firstName}-${guest.lastName}.png"`
    );
    res.setHeader('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Error downloading QR code' });
  }
};


// export const downloadAllQRCodes = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { eventId } = req.params;
//     const guests = await Guest.find({ eventId });

//     if (guests.length === 0) {
//       res.status(404).json({ message: 'No guests found' });
//       return;
//     }

//     const archive = archiver('zip', { zlib: { level: 9 } });
//     const zipBufferStream = new PassThrough();
//     archive.pipe(zipBufferStream);

//     for (const guest of guests) {
//       const bgColorHex = rgbToHex(guest.qrCodeBgColor);
//       const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
//       const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

//       const qrCodeContent = guest._id.toString();
//       console.log(`Generating QR for guest with ID: ${guest._id}`);

//       const qr = new QRCode({
//         content: qrCodeContent,
//         padding: 5,
//         width: 512,
//         height: 512,
//         color: edgeColorHex,
//         background: bgColorHex,
//         xmlDeclaration: false,
//       });
      

//       let svg = qr.svg();

//       svg = svg.replace(
//         /<svg([^>]*)>/,
//         `<svg$1>
//           <defs>
//             <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
//               <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
//               <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
//             </radialGradient>
//           </defs>`
//       );

//       svg = svg.replace(
//         /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
//         (match, group1, group2) => {
//           const isBoundingRect = /x="0".*y="0"/.test(group1);
//           return isBoundingRect
//             ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
//             : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
//         }
//       );

//       const pngBuffer = await sharp(Buffer.from(svg))
//         .resize(512, 512, { fit: 'contain' })
//         .png({ compressionLevel: 9, adaptiveFiltering: true })
//         .toBuffer();

//       archive.append(pngBuffer, {
//         name: `${guest.firstName}-${guest.lastName}.png`,
//       });
//     }

//     await archive.finalize();

//     const uploadPromise = new Promise<string>((resolve, reject) => {
//       const uploadStream = cloudinary.uploader.upload_stream(
//         { resource_type: 'raw', folder: 'qrcodes', format: 'zip' },
//         (error, result) => {
//           if (error) {
//             console.error('Cloudinary upload error:', error);
//             reject(error);
//           } else if (result && result.secure_url) {
//             resolve(result.secure_url);
//           } else {
//             reject(new Error('Invalid Cloudinary response'));
//           }
//         }
//       );
//       zipBufferStream.pipe(uploadStream);
//     });

//     const zipDownloadLink = await uploadPromise;
//     res.status(200).json({ zipDownloadLink });
//   } catch (error) {
//     console.error('Error:', error);
//     res.status(500).json({ message: 'Error generating ZIP file' });
//   }
// };

// export const downloadAllQRCodes = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { eventId } = req.params;
//     const guests = await Guest.find({ eventId });

//     if (guests.length === 0) {
//       res.status(404).json({ message: 'No guests found' });
//       return;
//     }

//     const archive = archiver('zip', { zlib: { level: 9 } });
//     const zipBufferStream = new PassThrough();
//     archive.pipe(zipBufferStream);

//     for (const guest of guests) {
//       if (!guest.qrCode) {
//         console.warn(`No QR code found for guest ${guest._id}`);
//         continue;
//       }

//       try {
//         // Get the original Cloudinary URL with transformations to ensure consistent format
//         const cloudinaryUrl = guest.qrCode;
        
//         // Add quality and format parameters to ensure consistent downloads
//         const downloadUrl = cloudinaryUrl.replace(
//           /upload\/(.*)\/qr_codes/,
//           'upload/q_auto,f_auto/qr_codes'
//         );

//         const response = await fetch(downloadUrl);
//         if (!response.ok) {
//           throw new Error(`Failed to fetch QR code: ${response.statusText}`);
//         }
//         const qrCodeBuffer = await response.buffer();
        
//         archive.append(qrCodeBuffer, {
//           name: `${guest.firstName}-${guest.lastName}.png`,
//         });
//       } catch (error) {
//         console.error(`Error fetching QR code for guest ${guest._id}:`, error);
//         // Fallback to generating the QR code if download fails
//         const bgColorHex = rgbToHex(guest.qrCodeBgColor);
//         const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
//         const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

//         const qr = new QRCode({
//           content: guest._id.toString(),
//           padding: 5,
//           width: 512,
//           height: 512,
//           color: edgeColorHex,
//           background: bgColorHex,
//           xmlDeclaration: false,
//         });

//         let svg = qr.svg();
//         svg = svg.replace(
//           /<svg([^>]*)>/,
//           `<svg$1>
//             <defs>
//               <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
//                 <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
//                 <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
//               </radialGradient>
//             </defs>`
//         );

//         svg = svg.replace(
//           /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
//           (match, group1, group2) => {
//             const isBoundingRect = /x="0".*y="0"/.test(group1);
//             return isBoundingRect
//               ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
//               : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
//           }
//         );

//         const pngBuffer = await sharp(Buffer.from(svg))
//           .resize(512, 512, { fit: 'contain' })
//           .png({ compressionLevel: 9, adaptiveFiltering: true })
//           .toBuffer();

//         archive.append(pngBuffer, {
//           name: `${guest.firstName}-${guest.lastName}.png`,
//         });
//       }
//     }

//     await archive.finalize();

//     const uploadPromise = new Promise<string>((resolve, reject) => {
//       const uploadStream = cloudinary.uploader.upload_stream(
//         { resource_type: 'raw', folder: 'qrcodes', format: 'zip' },
//         (error, result) => {
//           if (error) {
//             console.error('Cloudinary upload error:', error);
//             reject(error);
//           } else if (result && result.secure_url) {
//             resolve(result.secure_url);
//           } else {
//             reject(new Error('Invalid Cloudinary response'));
//           }
//         }
//       );
//       zipBufferStream.pipe(uploadStream);
//     });

//     const zipDownloadLink = await uploadPromise;
//     res.status(200).json({ zipDownloadLink });
//   } catch (error) {
//     console.error('Error:', error);
//     res.status(500).json({ message: 'Error generating ZIP file' });
//   }
// };


export const downloadAllQRCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const guests = await Guest.find({ eventId });

    if (guests.length === 0) {
      res.status(404).json({ message: 'No guests found' });
      return;
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipBufferStream = new PassThrough();
    archive.pipe(zipBufferStream);

    for (const guest of guests) {
      const bgColorHex = rgbToHex(guest.qrCodeBgColor);
      const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
      const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

      const qr = new QRCode({
        content: guest._id.toString(),
        padding: 5,
        width: 512,
        height: 512,
        color: edgeColorHex,
        background: bgColorHex,
        xmlDeclaration: false,
      });

      let svg = qr.svg();

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

      svg = svg.replace(
        /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
        (match, group1, group2) => {
          const isBoundingRect = /x="0".*y="0"/.test(group1);
          return isBoundingRect
            ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
            : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        }
      );

      const pngBuffer = await sharp(Buffer.from(svg))
        .resize(512, 512, { fit: 'contain' })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();

      archive.append(pngBuffer, {
        name: `${guest.firstName}-${guest.lastName}.png`,
      });
    }

    await archive.finalize();

    const uploadPromise = new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: 'raw', folder: 'qrcodes', format: 'zip' },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else if (result && result.secure_url) {
            resolve(result.secure_url);
          } else {
            reject(new Error('Invalid Cloudinary response'));
          }
        }
      );
      zipBufferStream.pipe(uploadStream);
    });

    const zipDownloadLink = await uploadPromise;
    res.status(200).json({ zipDownloadLink });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Error generating ZIP file' });
  }
};

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

    res
      .status(200)
      .json({ message: "All guests and their QR codes deleted successfully" });
  } catch (error) {
    console.error("Error deleting guests:", error);
    res.status(500).json({ message: "Error deleting guests" });
  }
};


export const scanQRCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { qrData } = req.body;

    if (!qrData) {
      res.status(400).json({ message: "QR Code data is missing" });
      return;
    }

    // Directly use qrData as the guest ID
    const guestId = qrData.trim();

    if (!guestId) {
      res.status(400).json({ message: "Guest ID is missing in QR code" });
      return;
    }

    // Find the guest by guestId
    const guest = await Guest.findById(guestId);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // Get the event details related to the guest's eventId
    const event = await Event.findById(guest.eventId);

    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    // Check if the guest has already checked in
    if (guest.checkedIn) {
      res.status(200).json({ message: "Guest already checked in", guest });
      return;
    }

    // Mark the guest as checked in and update their status
    guest.checkedIn = true;
    guest.status = "checked-in";
    const updatedGuest = await guest.save();

    // Send a response with the updated guest information and event details
    res.status(200).json({
      message: "Guest successfully checked in",
      guest: {
        firstName: guest.firstName,
        lastName: guest.lastName,
        eventName: event.name,
        eventDate: event.date,
        eventLocation: event.location,
      },
    });
  } catch (error) {
    console.error("🚨 Error during check-in:", error);
    res.status(500).json({ message: "Server error during check-in" });
  }
};






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
    const tempLink = `${process.env.FRONTEND_URL}/blog?token=${token}`;
    res.status(200).json({ tempLink });
  } catch (error) {
    console.error("Error generating temp link:", error);
    res.status(500).json({ message: "Error generating temp link" });
  }
};
