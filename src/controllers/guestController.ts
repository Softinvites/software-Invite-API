import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
import QRCode from "qrcode-svg";
import { invokeLambda } from '../utils/lambdaUtils';
import { uploadToS3, deleteFromS3 } from '../utils/s3Utils';
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";
import fetch from "node-fetch";
import { sendEmail } from "../library/helpers/emailService";
import { rgbToHex } from "../utils/colorUtils";
import sharp from "sharp";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import sanitizeHtml from "sanitize-html";

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });


export const addGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      fullname,
      TableNo,
      email,
      phone,
      message,
      others,
      eventId,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
    } = req.body;

    // Validate input
    const validateGuest = createGuestSchema.validate(req.body, option);
    if (validateGuest.error) {
      res.status(400).json({ error: validateGuest.error.details[0].message });
      return;
    }

    // Check event existence
    const event = await Event.findById(eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const iv = event.iv;

    // Create guest without QR fields first
    const newGuest = new Guest({
      fullname,
      message,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
      eventId,
      ...(email && { email }),
      ...(phone && { phone }),
      ...(TableNo && { TableNo }),
      ...(others && { others }),
    });

    const savedGuest = await newGuest.save();

    // Call Lambda to generate QR code SVG URL
    const lambdaPayload = {
      guestId: savedGuest._id.toString(),
      fullname,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
      eventId,
      TableNo,
      others
    };

    const lambdaRawResponse = await invokeLambda(
      process.env.QR_LAMBDA_FUNCTION_NAME!,
      lambdaPayload
    );

    // Validate Lambda response
    if (lambdaRawResponse.statusCode !== 200) {
      let errorBody;
      try {
        errorBody = JSON.parse(lambdaRawResponse.body);
      } catch {
        errorBody = { message: "Invalid response from QR Lambda" };
      }
      throw new Error(
        `QR Lambda failed: ${errorBody.error || errorBody.message || "Unknown error"}`
      );
    }

    let lambdaBody;
    try {
      lambdaBody = JSON.parse(lambdaRawResponse.body);
    } catch {
      throw new Error("Failed to parse QR Lambda response");
    }

    let qrCodeUrl = lambdaBody.qrCodeUrl;
    if (!qrCodeUrl || typeof qrCodeUrl !== "string") {
      throw new Error("QR Code URL is missing or invalid from Lambda response.");
    }

    // Ensure URL is absolute
    if (!/^https?:\/\//.test(qrCodeUrl)) {
      const s3Base =
        process.env.CDN_URL ||
        `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;
      qrCodeUrl = `${s3Base}${qrCodeUrl.startsWith("/") ? "" : "/"}${qrCodeUrl}`;
    }

    // Update guest with QR code URL and qrCodeData
    savedGuest.qrCode = qrCodeUrl;
    savedGuest.qrCodeData = savedGuest._id.toString();
    await savedGuest.save();

if (email) {
  try {
    const sanitizedMessage = sanitizeHtml(message, {
      allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br"],
      allowedAttributes: {},
    });

    const emailContent = `
      <div style="font-family: 'Georgia', serif; color: #000; background-color: #fff; padding: 20px;">
        <h2 style="text-align: center; font-weight: bold; font-size: 24px; margin-bottom: 10px;">${eventName}</h2>
        <hr style="border: none; border-top: 1px solid #ccc; margin: 10px auto; width: 60%;" />
        <div style="text-align: center; margin: 30px 0;">
          <img src="${iv}" alt="Invitation" width="400" style="border: 10px solid #7d0e2b; border-radius: 5px;" />
        </div>
        <p>Dear <strong>${fullname}</strong>,</p>
        <h3 style="font-weight: bold;">Traditional Wedding Ceremony</h3>
        ${sanitizedMessage}
        <p style="font-weight: bold; margin-top: 30px;">
          Please note: This event is strictly by invitation and this invitation is uniquely intended for you. A personalised QR code will be shared closer to the event date.
        </p>
        <p>Kindly acknowledge receipt of this e-invitation. We look forward to welcoming you at the event.</p>
        <p><strong>${eventName}</strong><br />
        <em>Message powered by SoftInvites.</em></p>
        <div style="text-align: center; margin: 40px 0;">
          <p><strong>Your QR Code:</strong></p>
          <img src="${qrCodeUrl}" alt="QR Code" width="200" style="margin-top: 10px;" />
        </div>
        <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; text-align: center; font-size: 14px; color: #666;">
          <p><strong>SoftInvites</strong><br />
          Lagos<br />
          Nigeria</p>
          <p style="font-size: 12px;">You received this email because you have been invited to this event.<br />
          <a href="#" style="color: #7d0e2b; text-decoration: underline;">Opt Out</a></p>
        </footer>
      </div>
    `;
 

    // Send the email
    await sendEmail(email, `${eventName}`, emailContent);
    console.log(`Invitation email sent to ${email}`);
  } catch (emailError) {
    console.error("Failed to send email:", emailError);
  }
}

// After successful create/update/delete operations:
await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.BACKUP_LAMBDA!,
  InvocationType: 'Event', // async
  Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
}));

    res.status(201).json({
      message: "Guest created successfully",
      guest: savedGuest,
    });
  } catch (error) {
    console.error("Error in addGuest:", error);
    res.status(500).json({
      message: "Error creating guest",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const importGuests = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
       res.status(400).json({ message: "No file uploaded" });
       return;
    }

    const eventId = req.body.eventId;
    if (!eventId) {
       res.status(400).json({ message: "Missing event ID" });
       return;
    }

    // Upload file to S3
    const fileKey = `uploads/${Date.now()}_${req.file.originalname}`;
    const fileUrl = await uploadToS3(req.file.buffer, fileKey, req.file.mimetype);
    console.log("Uploaded file to S3:", fileUrl);

    // Test fetch access
    const testFetch = await fetch(fileUrl);
    console.log("Fetch test status:", testFetch.status);
    if (!testFetch.ok) {
      throw new Error("Lambda won't be able to access this file.");
    }

    // Call Lambda to parse file and get initial guest data
    const lambdaResponse = await invokeLambda(
      process.env.IMPORT_LAMBDA_FUNCTION_NAME!,
      { fileUrl, eventId }
    );

    await deleteFromS3(fileKey); // Optional cleanup

    const result = JSON.parse(lambdaResponse.body || "{}");
    const statusCode = typeof lambdaResponse.statusCode === "number" ? lambdaResponse.statusCode : 500;

    if (statusCode !== 200) {
       res.status(statusCode).json({
        message: "Error importing guests",
        guests: [],
        successful: 0,
        error: result?.error || result?.message || "Unknown error from Lambda",
      });
      return;
    }

    const successfulGuests: any[] = [];

    for (const g of result.guests || []) {
      if (g.status !== "fulfilled") continue;
      const guest = g.value;

      // Save to DB to get Mongo ID
      const newGuest = new Guest({
        fullname: guest.fullname,
        TableNo: guest.TableNo,
        email: guest.email,
        phone: guest.phone,
        message: guest.message,
        others: guest.others,
        qrCodeBgColor: guest.qrCodeBgColor,
        qrCodeCenterColor: guest.qrCodeCenterColor,
        qrCodeEdgeColor: guest.qrCodeEdgeColor,
        eventId,
        status: "pending",
        imported: true,
        checkedIn: false,
      });

      const savedGuest = await newGuest.save();

      // Generate QR using real Mongo ID
      const lambdaPayload = {
        guestId: savedGuest._id.toString(),
        fullname: guest.fullname,
        qrCodeBgColor: guest.qrCodeBgColor,
        qrCodeCenterColor: guest.qrCodeCenterColor,
        qrCodeEdgeColor: guest.qrCodeEdgeColor,
        eventId,
        TableNo: guest.TableNo,
        others: guest.others,
      };

      const qrResponse = await invokeLambda(
        process.env.QR_LAMBDA_FUNCTION_NAME!,
        lambdaPayload
      );

      if (qrResponse.statusCode !== 200) {
        console.error("QR Lambda failed for guest:", guest.fullname);
        continue;
      }

      let qrCodeUrl = "";
      try {
        const qrBody = JSON.parse(qrResponse.body);
        qrCodeUrl = qrBody.qrCodeUrl;
      } catch (err) {
        console.error("Failed to parse QR Lambda response:", err);
      }

      if (!qrCodeUrl || typeof qrCodeUrl !== "string") {
        console.error("Invalid or missing QR Code URL for guest:", guest.fullname);
        continue;
      }

      savedGuest.qrCode = qrCodeUrl;
      savedGuest.qrCodeData = savedGuest._id.toString();
      await savedGuest.save();

      successfulGuests.push(savedGuest);
    }

    // After successful create/update/delete operations:
await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.BACKUP_LAMBDA!,
  InvocationType: 'Event', // async
  Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
}));

    res.status(201).json({
      message: `Imported ${result.totalProcessed} guests, saved ${successfulGuests.length} to DB`,
      guests: successfulGuests,
      successCount: result.successful,
      failedCount: result.failed,
    });

  } catch (error) {
    console.error("Error importing guests (controller):", error);
    res.status(500).json({
      message: "Error importing guests",
      guests: [],
      successful: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};


export const updateGuest = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      email,
      phone,
      fullname,
      TableNo,
      message,
      others,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
    } = req.body;

    const validateGuest = updateGuestSchema.validate(req.body, option);
    if (validateGuest.error) {
      res.status(400).json({ Error: validateGuest.error.details[0].message });
      return;
    }

    const guest = await Guest.findById(id);
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    const qrColorsChanged =
      qrCodeBgColor !== guest.qrCodeBgColor ||
      qrCodeCenterColor !== guest.qrCodeCenterColor ||
      qrCodeEdgeColor !== guest.qrCodeEdgeColor;

    guest.fullname = fullname || guest.fullname;
    guest.TableNo = TableNo || guest.TableNo;
    guest.email = email || guest.email;
    guest.phone = phone || guest.phone;
    guest.message = sanitizeHtml(message) || guest.message;
    guest.others = others || guest.others;

    if (qrColorsChanged) {
      guest.qrCodeBgColor = qrCodeBgColor || guest.qrCodeBgColor;
      guest.qrCodeCenterColor = qrCodeCenterColor || guest.qrCodeCenterColor;
      guest.qrCodeEdgeColor = qrCodeEdgeColor || guest.qrCodeEdgeColor;

      // Generate new QR via Lambda
      const lambdaResponse = await invokeLambda(process.env.QR_LAMBDA_FUNCTION_NAME!, {
        guestId: guest._id.toString(),
        fullname: fullname || guest.fullname,
        bgColorHex: rgbToHex(qrCodeBgColor || guest.qrCodeBgColor),
        centerColorHex: rgbToHex(qrCodeCenterColor || guest.qrCodeCenterColor),
        edgeColorHex: rgbToHex(qrCodeEdgeColor || guest.qrCodeEdgeColor),
        eventId: guest.eventId,
      });

      const { qrCodeUrl } = lambdaResponse;

      // Delete old QR from S3 if exists
      if (guest.qrCode) {
        try {
          const url = new URL(guest.qrCode);
          const key = url.pathname.substring(1);
          await deleteFromS3(key);
        } catch (error) {
          console.error("Error deleting old QR:", error);
        }
      }

      guest.qrCode = qrCodeUrl;
      await guest.save();

      if (guest.email) {
        const emailContent = `
          <h2>Your Event QR Code Has Been Updated</h2>
          <p>Dear ${guest.fullname},</p>
          <p>Your QR code for the event has been updated.</p>
          <p><img src="${qrCodeUrl}" alt="QR Code" width="300"/></p>
        `;
        await sendEmail(guest.email, `Your Updated QR Code`, emailContent);
      }

      // After successful create/update/delete operations:
await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.BACKUP_LAMBDA!,
  InvocationType: 'Event', // async
  Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
}));

      res.status(200).json({
        message: "Guest updated successfully and QR code regenerated",
        guest,
      });
    } else {
      await guest.save();
      res.status(200).json({ message: "Guest updated successfully", guest });
    }
  } catch (error) {
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
      .resize(512, 512, { fit: "contain" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

  // 👇 Safe filename logic here
  const safeName = guest.fullname?.replace(/[^a-zA-Z0-9-_]/g, "_") || "guest";
  const safeTableNo = guest.TableNo?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noTable";
  const safeOthers = guest.others?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noOthers";
  const guestId = guest._id.toString();

  const filename = `qr-${safeName}_${safeTableNo}_${safeOthers}_${guestId}.png`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "image/png");
  res.send(pngBuffer);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Error downloading QR code" });
  }
};

export const downloadAllQRCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;

    const guests = await Guest.find({ eventId });

    if (!guests.length) {
      res.status(404).json({ message: "No guests found" });
      return;
    }

    const qrPaths = guests
      .map((guest) => {
        try {
          if (!guest.qrCode || typeof guest.qrCode !== "string") return null;
          const url = new URL(guest.qrCode);
          const path = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
          return path.endsWith(".svg") ? path : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as string[];

    if (!qrPaths.length) {
      res.status(400).json({ message: "No valid QR code paths found" });
      return;
    }

    const lambdaResponse = await invokeLambda(process.env.ZIP_LAMBDA_FUNCTION_NAME!, {
      qrPaths,
      eventId,
    });


    const statusCode = lambdaResponse?.statusCode || 500;

    let parsedBody: any = {};
    try {
      parsedBody = lambdaResponse?.body ? JSON.parse(lambdaResponse.body) : {};
    } catch {
      parsedBody = { error: "Failed to parse Lambda response" };
    }

    if (statusCode !== 200 || !parsedBody.zipUrl) {
      res.status(statusCode).json({
        message: "Lambda failed to create ZIP archive",
        error: parsedBody?.error || "Unknown Lambda error",
        missingFiles: parsedBody?.missingFiles || [],
      });
      return;
    }

    res.status(200).json({
      zipDownloadLink: parsedBody.zipUrl,
      generatedAt: parsedBody.generatedAt,
      eventId: parsedBody.eventId,
      numberOfFiles: parsedBody.numberOfFiles,
      missingFiles: parsedBody.missingFiles || [],
    });

  } catch (error) {
    console.error("Error in downloadAllQRCodes:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error instanceof Error ? error.message : error,
    });
  }
};


export const downloadBatchQRCodes = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { start, end } = req.query;

    const startDate = start ? new Date(start as string) : new Date(0);
    const endDate = end ? new Date(end as string) : new Date();

    const guests = await Guest.find({
      eventId,
      createdAt: { $gte: startDate, $lte: endDate },
    });

    if (!guests.length) {
      res.status(404).json({ message: "No guests found for given date range" });
      return;
    }

  const qrPaths = guests
  .map((guest) => {
    try {
      if (!guest.qrCode || typeof guest.qrCode !== "string") return null;
      const url = new URL(guest.qrCode);
      const path = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
      // 👇 Decode URI component so %20 stays as %20
      return decodeURI(path.endsWith(".svg") ? path : "");
    } catch {
      return null;
    }
  })
  .filter(Boolean) as string[];


    if (!qrPaths.length) {
      res.status(400).json({ message: "No valid QR code paths found in the given range" });
      return;
    }

    const lambdaResponse = await invokeLambda(process.env.ZIP_LAMBDA_FUNCTION_NAME!, {
      qrPaths,
      eventId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    const statusCode = lambdaResponse?.statusCode || 500;

    let parsedBody: any = {};
    try {
      parsedBody = lambdaResponse?.body ? JSON.parse(lambdaResponse.body) : {};
    } catch {
      parsedBody = { error: "Failed to parse Lambda response" };
    }

    if (statusCode !== 200 || !parsedBody.zipUrl) {
      res.status(statusCode).json({
        message: "Lambda failed to create ZIP archive",
        error: parsedBody?.error || "Unknown Lambda error",
        missingFiles: parsedBody?.missingFiles || [],
      });
      return;
    }

    res.status(200).json({
      zipDownloadLink: parsedBody.zipUrl,
      generatedAt: parsedBody.generatedAt,
      eventId: parsedBody.eventId,
      numberOfFiles: parsedBody.numberOfFiles,
      missingFiles: parsedBody.missingFiles || [],
    });

  } catch (error) {
    console.error("Error in downloadBatchQRCodes:", error);
    res.status(500).json({
      message: "Internal server error while creating batch QR ZIP",
      error: error instanceof Error ? error.message : error,
    });
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

export const deleteGuestById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const guest = await Guest.findById(id);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // Delete from S3
    if (guest.qrCode) {
      const url = new URL(guest.qrCode);
      const key = url.pathname.substring(1); // Remove leading slash
      await deleteFromS3(key);
    }

    await Guest.findByIdAndDelete(id);
    res.status(200).json({ message: "Guest deleted successfully" });
  } catch (error) {
    console.error("Error deleting guest:", error);
    res.status(500).json({ message: "Error deleting guest" });
  }
};


export const deleteGuestsByEvent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;

    const guests = await Guest.find({ eventId });
    if (!guests.length) {
      res.status(404).json({ message: "No guests found for this event" });
      return;
    }

    // Delete QR codes from S3
    const deletionPromises = guests.map(async (guest) => {
      if (guest.qrCode) {
        try {
          const key = new URL(guest.qrCode).pathname.slice(1);
          await deleteFromS3(key);
        } catch (err) {
          console.error(`Failed to delete QR for ${guest.fullname}:`, err);
        }
      }
    });

    await Promise.allSettled(deletionPromises);
    await Guest.deleteMany({ eventId });

    // After successful create/update/delete operations:
await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.BACKUP_LAMBDA!,
  InvocationType: 'Event', // async
  Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
}));

    res.status(200).json({ 
      message: "All guests and their QR codes deleted successfully",
      deletedCount: guests.length
    });
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

    if (!start || !end) {
      res.status(400).json({ message: "start and end query params are required" });
      return;
    }

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({ message: "Invalid start or end date" });
      return;
    }

    const guests = await Guest.find({
      eventId,
      createdAt: { $gte: startDate, $lte: endDate }
    });

    if (!guests.length) {
      res.status(404).json({ message: "No guests found for the event/date range" });
      return;
    }

    const deletionPromises = guests.map(async (guest) => {
      if (guest.qrCode) {
        try {
          const key = new URL(guest.qrCode).pathname.slice(1);
          await deleteFromS3(key);
        } catch (err) {
          console.error(`Error deleting QR for ${guest.fullname}:`, err);
        }
      }
    });

    await Promise.allSettled(deletionPromises);

    const deleteResult = await Guest.deleteMany({
      eventId,
      createdAt: { $gte: startDate, $lte: endDate }
    });

// After successful create/update/delete operations:
await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.BACKUP_LAMBDA!,
  InvocationType: 'Event', // async
  Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
}));
    res.status(200).json({
      message: `Deleted ${deleteResult.deletedCount} guests for event ${eventId}`
    });
  } catch (error) {
    console.error("Error deleting guests by event + timestamp:", error);
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
    await guest.save();

    // Send a response with the updated guest information and event details
    res.status(200).json({
      message: "Guest successfully checked in",
      guest: {
        fullname: guest.fullname,
        TableNo: guest.TableNo,
        others: guest.others,
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

export const generateEventAnalytics = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ message: "Invalid event ID format" });
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
