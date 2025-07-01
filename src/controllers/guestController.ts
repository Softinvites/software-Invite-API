import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
import QRCode from "qrcode-svg";
import archiver from "archiver";
import xlsx from "xlsx";
import * as fastcsv from "fast-csv";
import { cloudinary } from "../library/helpers/uploadImage";
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";
import fetch from "node-fetch";
import { sendEmail } from "../library/helpers/emailService";
import { rgbToHex } from "../utils/colorUtils";
import sharp from "sharp";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";



// **Add a Guest & Generate QR Code**
export const addGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      fullname,
      seatNo,
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
  fullname,
  seatNo,
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
  /<rect([^>]*?)(?=style="fill:#[0-9a-fA-F]{3,6};")/g,  
  (match, group1) => `<rect${group1}style="fill:url(#grad1);"/>`  
);  

// Keep the background rectangle unchanged  
svg = svg.replace(  
  /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,  
  (match, group1, group2) => {  
    const isBoundingRect = /x="0".*y="0"/.test(group1);  
    return isBoundingRect  
      ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`  
      : match; // No change to already matched rectangles  
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
      public_id: `${fullname}_${seatNo}_qr`,
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
        <p>Dear ${fullname},</p>
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

type GuestType = {
  fullname: string;
  seatNo: string;
  email?: string;
  phone?: string;
  eventId: string;
  qrCodeBgColor: string;
  qrCodeCenterColor: string;
  qrCodeEdgeColor: string;
};

function chunk<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

export async function processGuests(
  guests: GuestType[],
  res: Response
): Promise<void> {
  try {
    const results: PromiseSettledResult<any>[] = [];
    const batchSize = 20; // Adjust this based on server capacity
    const batches = chunk(guests, batchSize);

    for (const batch of batches) {
      const settled = await Promise.allSettled(
        batch.map(async (guest) => {
          const {
            fullname,
            seatNo,
            email,
            phone,
            eventId,
            qrCodeBgColor,
            qrCodeCenterColor,
            qrCodeEdgeColor,
          } = guest;

          const event = await Event.findById(eventId);
          if (!event) throw new Error('Event not found');

          const eventName = event.name;
          const eventDate = event.date;
          const eventLocation = event.location;

          const bgColorHex = rgbToHex(qrCodeBgColor);
          const centerColorHex = rgbToHex(qrCodeCenterColor);
          const edgeColorHex = rgbToHex(qrCodeEdgeColor);

          const newGuest = new Guest({
            fullname,
            seatNo,
            qrCodeBgColor,
            qrCodeCenterColor,
            qrCodeEdgeColor,
            eventId,
            ...(phone && { phone }),
            ...(email && { email }),
          });

          const savedGuest = await newGuest.save();
          const guestId = savedGuest._id.toString();
          const qrCodeData = guestId;

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

          const qrCodeUrl = await new Promise<string>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: 'qr_codes',
                public_id: `${fullname}_${seatNo}_${guestId}_qr`,
                overwrite: true,
                format: 'png',
              },
              (error, result) => {
                if (error || !result?.secure_url) {
                  console.error(`❌ Cloudinary upload failed for ${fullname} ${seatNo}:`, error);
                  return reject(new Error(`Cloudinary upload failed for ${fullname} ${seatNo}`));
                }
                resolve(result.secure_url);
              }
            );
            uploadStream.end(pngBuffer);
          });

          savedGuest.qrCode = qrCodeUrl;
          savedGuest.qrCodeData = qrCodeData;
          await savedGuest.save();

          if (email) {
            const emailContent = `
              <h2>Welcome to ${eventName}!</h2>
              <p>Dear ${fullname},</p>
              <p>We are delighted to invite you to <strong>${eventName}</strong>.</p>
              <h3>Event Details:</h3>
              <p><strong>Date:</strong> ${eventDate}</p>
              <p><strong>Location:</strong> ${eventLocation}</p>
              <p><strong>Description:</strong> ${event.description}</p>
              <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
              <img src="${qrCodeUrl}" alt="QR Code" />
              <p>See you at ${eventName}!</p>
            `;
            await sendEmail(email, `Your Invitation to ${eventName}`, emailContent);
          }

          return { email, success: true };
        })
      );

      results.push(...settled);
    }

    const successCount = results.filter((r) => r.status === 'fulfilled').length;

    res.status(201).json({
      message: `${successCount} guests imported successfully`,
      errors: results
        .filter((r) => r.status === 'rejected')
        .map((err) => err.reason),
    });
  } catch (error) {
    console.error('Error processing imported guests:', error);
    res.status(500).json({ message: 'Error processing imported guests', error });
  }
}




export const updateGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { email, fullname, seatNo, eventId, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor } = req.body;

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
    guest.fullname = fullname || guest.fullname;
    guest.seatNo = seatNo || guest.seatNo;
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
        public_id: `${fullname}_${seatNo}_qr`,
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
              <p>Dear ${fullname},</p>
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
      `attachment; filename="qr-${guest.fullname}-${guest.seatNo}.png"`
    );
    res.setHeader('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Error downloading QR code' });
  }
};


// export const downloadAllQRCodes = async (req: Request, res: Response): Promise<void> => {

//   res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
//   res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
//   res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
//   res.setHeader("Access-Control-Allow-Credentials", "true");

//   if (req.method === 'OPTIONS') {
//     res.status(204).end();
//     return;
//   }

//   try {
//     const { eventId } = req.params;
//     const guests = await Guest.find({ eventId });

//     if (guests.length === 0) {
//       res.status(404).json({ message: 'No guests found' });
//       return;
//     }

//     // Step 1: Create archive and upload stream
//     const archive = archiver('zip', { zlib: { level: 9 } });

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

//       archive.pipe(uploadStream);
//     });

//     // Step 2: Append QR code PNGs to archive
//     for (const guest of guests) {
//       const bgColorHex = rgbToHex(guest.qrCodeBgColor);
//       const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
//       const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

//       const qr = new QRCode({
//         content: guest._id.toString(),
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
//         name: `${guest.fullname}-${guest.seatNo}.png`,
//       });
//     }

//     // Step 3: Finalize and await upload
//     archive.finalize();
//     const zipDownloadLink = await uploadPromise;

//     // Step 4: Send response
//     res.status(200).json({ zipDownloadLink });

//   } catch (error) {
//     console.error('Error:', error);
//     res.status(500).json({ message: 'Error generating ZIP file' });
//   }
// };


// Helper function to convert RGB to Hex


// Helper function for batch processing

const processBatch = async (guestsBatch: any[]) => {
  const batchPromises = guestsBatch.map(async (guest) => {
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

    // Add radial gradient for color transitions
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

    // Apply gradient to QR code
    svg = svg.replace(
      /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
      (match, group1, group2) => {
        const isBoundingRect = /x="0".*y="0"/.test(group1);
        return isBoundingRect
          ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
          : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
      }
    );

    // Convert SVG to PNG and return buffer
    const pngBuffer = await sharp(Buffer.from(svg))
      .resize(512, 512, { fit: 'contain' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    return {
      name: `${guest.fullname}-${guest.seatNo}.png`,
      buffer: pngBuffer,
    };
  });

  // Wait for all batch promises to resolve
  return Promise.all(batchPromises);
};

export const downloadAllQRCodes = async (req: Request, res: Response): Promise<void> => {

  try {
    const { eventId } = req.params;
    const guests = await Guest.find({ eventId });

    if (guests.length === 0) {
       res.status(404).json({ message: 'No guests found' });
       return;
    }

    // Create a ZIP archive and prepare upload stream
    const archive = archiver('zip', { zlib: { level: 9 } });
    const uploadPromise = new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { resource_type: 'raw', folder: 'qrcodes', format: 'zip' },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else if (result?.secure_url) {
            resolve(result.secure_url);
          } else {
            reject(new Error('Invalid Cloudinary response'));
          }
        }
      );
      archive.pipe(uploadStream);
    });

    // Batching guests to avoid overload and enhance performance
    const batchSize = 20; // Adjust batch size depending on performance
    const batchCount = Math.ceil(guests.length / batchSize);

    // Process guests in batches and append them to the archive
    for (let i = 0; i < batchCount; i++) {
      const batchStart = i * batchSize;
      const batchEnd = batchStart + batchSize;
      const guestsBatch = guests.slice(batchStart, batchEnd);

      // Process batch asynchronously
      const batchResults = await processBatch(guestsBatch);

      // Append batch results to archive
      batchResults.forEach((result) => {
        archive.append(result.buffer, { name: result.name });
      });
    }

    // Finalize archive and await Cloudinary upload
    archive.finalize();
    const zipDownloadLink = await uploadPromise;

    // Return the Cloudinary URL of the zip file
     res.status(200).json({ zipDownloadLink });
     return;

  } catch (error) {
    console.error('Error:', error);
     res.status(500).json({ message: 'Error generating ZIP file' });
     return;
  }
};

// export const enqueueQRCodeDownload = async (req: Request, res: Response) => {
//   const { eventId } = req.params;

//   const task = new DownloadTask({ eventId });
//   await task.save();

//   res.status(202).json({ taskId: task._id });
// };



export const downloadBatchQRCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { start, end } = req.query;

    // Validate and parse dates
    const startDate = start ? new Date(start as string) : new Date(0);
    const endDate = end ? new Date(end as string) : new Date();

    const guests = await Guest.find({
      eventId,
      createdAt: { $gte: startDate, $lte: endDate },
    });
  console.log("Start:", startDate.toISOString());
console.log("End:", endDate.toISOString());
console.log("Matched guests:", guests.length);


    if (guests.length === 0) {
      res.status(404).json({ message: 'No guests found for given date range' });
      return;
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

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
      archive.pipe(uploadStream);
    });

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
        name: `${guest.fullname}-${guest.seatNo}.png`,
      });
    }

    archive.finalize();
    const zipDownloadLink = await uploadPromise;

    res.status(200).json({ zipDownloadLink });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Error generating QR batch ZIP' });
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

export const deleteGuestsByEventAndTimestamp = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { start, end } = req.query;

    // 1️⃣ Validate inputs
    if (!start || !end) {
      res.status(400).json({ message: "start and end query params are required" });
      return;
    }
    const startDate = new Date(start as string);
    const endDate = new Date(end as string);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({ message: "Invalid date in start/end" });
      return;
    }

    // 2️⃣ Find guests by event AND createdAt range
    const guests = await Guest.find({
      eventId,
      createdAt: { $gte: startDate, $lte: endDate },
    });

    if (guests.length === 0) {
      res.status(404).json({ message: "No guests found for that event/date range" });
      return;
    }

    // 3️⃣ Delete QR codes on Cloudinary
    const deletionPromises = guests.map(async (guest) => {
      if (guest.qrCode) {
        const match = guest.qrCode.match(/\/qr_codes\/([^/.]+)\./);
        if (match) {
          return cloudinary.uploader.destroy(`qr_codes/${match[1]}`);
        }
      }
    });
    await Promise.allSettled(deletionPromises);

    // 4️⃣ Delete guests from DB
    const result = await Guest.deleteMany({
      eventId,
      createdAt: { $gte: startDate, $lte: endDate },
    });

    res
      .status(200)
      .json({ message: `Deleted ${result.deletedCount} guests for event ${eventId}` });
  } catch (error) {
    console.error("Error deleting guests by event+timestamp:", error);
    res.status(500).json({ message: "Internal server error" });
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
        fullname: guest.fullname,
        seatNo: guest.seatNo,
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
    // Basic counts
    const totalEvents = await Event.countDocuments();
    const totalGuests = await Guest.countDocuments();
    const checkedInGuests = await Guest.countDocuments({ checkedIn: true });
    const unusedCodes = totalGuests - checkedInGuests;

    // Guest status breakdown (pie chart data)
    const guestStatusBreakdownRaw = await Guest.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);
    const guestStatusBreakdown = guestStatusBreakdownRaw.map((item) => ({
      label: item._id,
      value: item.count,
    }));

    // Check-in trend (last 7 days)
    const checkInTrendRaw = await Guest.aggregate([
      {
        $match: {
          checkedIn: true,
          updatedAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const checkInTrend = checkInTrendRaw.map((item) => ({
      date: item._id,
      count: item.count,
    }));

    // Send everything
    res.status(200).json({
      totalEvents,
      totalGuests,
      checkedInGuests,
      unusedCodes,
      guestStatusBreakdown,
      checkInTrend,
    });
  } catch (error) {
    console.error("Error generating analytics:", error);
    res.status(500).json({ message: "Error generating analytics" });
  }
};

export const generateEventAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
       res.status(400).json({ message: 'Invalid event ID format' });
       return;
    }

    // Get all guests using `eventId` (your schema design)
    const guests = await Guest.find({ eventId });

    if (!guests.length) {
       res.status(200).json({
        eventId,
        totalGuests: 0,
        checkedInGuests: 0,
        unusedCodes: 0,
        guestStatusBreakdown: [],
        checkInTrend: [],
      });
      return;
    }

    const totalGuests = guests.length;

    const checkedInGuests = await Guest.countDocuments({
      eventId,
      checkedIn: true,
    });

    const unusedCodes = totalGuests - checkedInGuests;

    // Guest status breakdown
    const guestStatusBreakdownRaw = await Guest.aggregate([
      {
        $match: {
          eventId: new mongoose.Types.ObjectId(eventId),
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const guestStatusBreakdown = guestStatusBreakdownRaw.map((item) => ({
      label: item._id,
      value: item.count,
    }));

    // Check-in trend (last 7 days)
    const checkInTrendRaw = await Guest.aggregate([
      {
        $match: {
          eventId: new mongoose.Types.ObjectId(eventId),
          checkedIn: true,
          updatedAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const checkInTrend = checkInTrendRaw.map((item) => ({
      date: item._id,
      count: item.count,
    }));

    res.status(200).json({
      eventId,
      totalGuests,
      checkedInGuests,
      unusedCodes,
      guestStatusBreakdown,
      checkInTrend,
    });
  } catch (error) {
    console.error("Error generating event analytics:", error);
    res.status(500).json({ message: "Error generating event analytics" });
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
    const tempLink = `${process.env.FRONTEND_URL}/guest?token=${token}`;
    res.status(200).json({ tempLink });
  } catch (error) {
    console.error("Error generating temp link:", error);
    res.status(500).json({ message: "Error generating temp link" });
  }
};
