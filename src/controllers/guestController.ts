import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
import { invokeLambda } from "../utils/lambdaUtils";
import { uploadToS3, deleteFromS3 } from "../utils/s3Utils";
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";
import { buildInvitationEmail, versionedImageUrl } from "../utils/buildInvitationEmail.js";
import { buildEventEmailFrom } from "../utils/emailSender";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";
import sanitizeHtml from "sanitize-html";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import fetch from "node-fetch";
import { createHash } from "node:crypto";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-2" });

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

const normalizeName = (value?: string) =>
  (value || "").trim().replace(/\s+/g, " ").toLowerCase();

const buildPngUrl = (eventId?: string, guestId?: string) => {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || "us-east-2";
  if (!bucket || !eventId || !guestId) return "";
  return `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/png/${eventId}/${guestId}.png`;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const inferImageContentType = (url: string) => {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return String(url || "").toLowerCase();
    }
  })();

  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};

const resolveAttachmentExtension = (contentType: string) => {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
};

const extractS3KeyFromUrl = (url?: string) => {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".s3.")) {
      return null;
    }

    return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
};

const isHttpUrl = (value?: string) => {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const resolveGuestEmailQrUrl = (pngUrl?: string, qrValue?: string) => {
  if (isHttpUrl(pngUrl)) return pngUrl || "";
  if (isHttpUrl(qrValue)) return qrValue || "";
  return "";
};

const invokeEmailLambdaDirect = async (
  payload: Record<string, unknown>,
  retries = 5,
) => {
  if (!process.env.EMAIL_LAMBDA_FUNCTION_NAME) {
    throw new Error("EMAIL_LAMBDA_FUNCTION_NAME is not configured");
  }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await invokeLambda(process.env.EMAIL_LAMBDA_FUNCTION_NAME, payload, true);
      return;
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }

      const backoff = Math.min(8000, 500 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 200);
      await sleep(backoff + jitter);
    }
  }
};

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

    // --- Validate Input ---
    const validateGuest = createGuestSchema.validate(req.body, option);
    if (validateGuest.error) {
      res.status(400).json({ error: validateGuest.error.details[0].message });
      return;
    }

    // --- Check Event Existence ---
    const event = await Event.findById(eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const eventDate = event.date;
    const iv = event.iv;

    // Block duplicate names within the same event (case/space insensitive)
    const normalizedFullname = normalizeName(fullname);
    const existingGuest = await Guest.findOne({
      eventId,
      normalizedFullname,
    });
    if (existingGuest) {
      res
        .status(400)
        .json({
          message: "A guest with this name already exists for the event",
        });
      return;
    }

    // --- Create Guest (no QR yet) ---
    const newGuest = new Guest({
      fullname: fullname.trim().replace(/\s+/g, " "),
      normalizedFullname,
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

    // --- Call Lambda to generate QR ---
    const lambdaPayload = {
      guestId: savedGuest._id.toString(),
      fullname,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
      eventId,
      TableNo,
      others,
    };

    // console.log("📤 Sending to Lambda:", lambdaPayload);

    let qrSvg, qrCodeUrl;

    try {
      const lambdaResponse = await invokeLambda(
        process.env.QR_LAMBDA_FUNCTION_NAME!,
        lambdaPayload,
      );
      // Parse the nested response structure
      let parsedBody;
      if (lambdaResponse.body) {
        if (typeof lambdaResponse.body === "string") {
          try {
            parsedBody = JSON.parse(lambdaResponse.body);
          } catch (parseError) {
            console.error(
              "❌ Failed to parse Lambda response body:",
              parseError,
            );
            parsedBody = {};
          }
        } else {
          parsedBody = lambdaResponse.body;
        }
      } else {
        parsedBody = lambdaResponse;
      }

      // Extract QR data from parsed body
      qrSvg = parsedBody?.qrSvg;
      qrCodeUrl = parsedBody?.qrCodeUrl;
    } catch (lambdaError) {
      console.error("❌ Lambda invocation failed:", lambdaError);
      qrSvg = "";
      qrCodeUrl = "";
    }

    // Update guest with QR data
    savedGuest.qrCode = qrCodeUrl || qrSvg || "";
    savedGuest.qrCodeData = savedGuest._id.toString();
    await savedGuest.save();

    // Convert SVG -> PNG locally and upload to S3 (store pngUrl on guest)

    if (qrCodeUrl || qrSvg) {
      try {
        const pngLambdaName = process.env.PNG_CONVERT_LAMBDA;
        if (!pngLambdaName) {
          console.warn("PNG_CONVERT_LAMBDA not set; skipping PNG conversion");
        } else {
          const pngLambdaResp: any = await invokeLambda(pngLambdaName, {
            guestId: savedGuest._id.toString(),
            eventId,
            svg: qrSvg,
            qrCodeUrl,
          });

          let parsedPngResult: any = {};
          try {
            parsedPngResult = pngLambdaResp?.body
              ? typeof pngLambdaResp.body === "string"
                ? JSON.parse(pngLambdaResp.body)
                : pngLambdaResp.body
              : pngLambdaResp || {};
          } catch (parseErr) {
            console.warn(
              "Failed to parse PNG lambda response body:",
              parseErr,
              pngLambdaResp,
            );
            parsedPngResult = pngLambdaResp || {};
          }

          const pngUrl =
            parsedPngResult?.pngUrl || parsedPngResult?.url || "";

          if (pngUrl) {
            savedGuest.pngUrl = pngUrl;
            await savedGuest.save();
          }
        }
      } catch (pngError) {
        console.error("❌ PNG generation/upload failed:", pngError);
      }
    }

    // Emails are sent only from the guest page via "Send Emails".
    const emailSent = false;
    const emailErrorMessage: string | null = null;

    // --- Trigger Backup Lambda (async) ---
    try {
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: process.env.BACKUP_LAMBDA!,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({})),
        }),
      );
    } catch (backupError) {
      console.error("Backup Lambda failed:", backupError);
    }

    res.status(201).json({
      message: "Guest created successfully",
      guest: savedGuest,
      emailSent,
      ...(emailErrorMessage ? { emailError: emailErrorMessage } : {}),
    });
  } catch (error) {
    console.error("Error in addGuest:", error);
    res.status(500).json({
      message: "Error creating guest",
      error: error instanceof Error ? error.message : error,
    });
  }
};


export const updateGuest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // Handle both JSON string and already-parsed object
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      id,
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
    } = body;

    if (!id) {
      res.status(400).json({ message: "Guest ID is required" });
      return;
    }

    const validateGuest = updateGuestSchema.validate(body, option);
    if (validateGuest.error) {
      res.status(400).json({ Error: validateGuest.error.details[0].message });
      return;
    }

    const guest = await Guest.findById(id);
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // --- Check Event Existence ---
    const event = await Event.findById(eventId || guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const eventDate = event.date;
    const iv = event.iv;
    const targetEventId = (eventId as any) || guest.eventId;

    // Prevent duplicate names within the same event when updating
    if (fullname !== undefined) {
      const cleanedName = String(fullname).trim().replace(/\s+/g, " ");
      const normalizedFullname = normalizeName(cleanedName);
      const duplicate = await Guest.findOne({
        eventId: targetEventId,
        normalizedFullname,
        _id: { $ne: guest._id },
      });
      if (duplicate) {
        res
          .status(400)
          .json({
            message: "A guest with this name already exists for the event",
          });
        return;
      }
      guest.fullname = cleanedName;
      guest.normalizedFullname = normalizedFullname;
    }

    // Store original values for comparison
    const originalEmail = guest.email;
    const emailChanged = email !== undefined && email !== originalEmail;

    // Check if QR colors changed (only if provided in request)
    const qrColorsChanged =
      (qrCodeBgColor !== undefined && qrCodeBgColor !== guest.qrCodeBgColor) ||
      (qrCodeCenterColor !== undefined &&
        qrCodeCenterColor !== guest.qrCodeCenterColor) ||
      (qrCodeEdgeColor !== undefined &&
        qrCodeEdgeColor !== guest.qrCodeEdgeColor);

    // Update guest fields only if provided (proper optional field handling)
    if (eventId !== undefined) guest.eventId = eventId;
    if (TableNo !== undefined) guest.TableNo = TableNo;
    if (email !== undefined) guest.email = email;
    if (phone !== undefined) guest.phone = phone;
    if (message !== undefined) {
      guest.message = sanitizeHtml(message, {
        allowedTags: [
          "p",
          "b",
          "i",
          "strong",
          "em",
          "ul",
          "li",
          "br",
          "h1",
          "h2",
        ],
        allowedAttributes: {},
      });
    }
    if (others !== undefined) guest.others = others;

    let qrCodeUrl = guest.qrCode;
    let qrCodeRegenerated = false;

    // --- REGENERATE QR CODE IF MISSING ---
    if (!guest.qrCode) {
      // console.log("🔄 QR code missing in database, generating now...");

      // Set colors if provided, otherwise use existing or defaults
      if (qrCodeBgColor !== undefined) guest.qrCodeBgColor = qrCodeBgColor;
      if (qrCodeCenterColor !== undefined)
        guest.qrCodeCenterColor = qrCodeCenterColor;
      if (qrCodeEdgeColor !== undefined)
        guest.qrCodeEdgeColor = qrCodeEdgeColor;

      // Ensure we have colors (use existing or defaults)
      guest.qrCodeBgColor = guest.qrCodeBgColor || "#FFFFFF";
      guest.qrCodeCenterColor = guest.qrCodeCenterColor || "#000000";
      guest.qrCodeEdgeColor = guest.qrCodeEdgeColor || "#7d0e2b";

      const lambdaPayload = {
        guestId: guest._id.toString(),
        fullname: guest.fullname,
        qrCodeBgColor: guest.qrCodeBgColor,
        qrCodeCenterColor: guest.qrCodeCenterColor,
        qrCodeEdgeColor: guest.qrCodeEdgeColor,
        eventId: guest.eventId,
        TableNo: guest.TableNo,
        others: guest.others,
      };

      // console.log("📤 Generating missing QR code:", lambdaPayload);

      let qrSvg, lambdaResponse;
      try {
        lambdaResponse = await invokeLambda(
          process.env.QR_LAMBDA_FUNCTION_NAME!,
          lambdaPayload,
        );
        // console.log("✅ Lambda Response for missing QR:", JSON.stringify(lambdaResponse, null, 2));

        // Parse the nested response structure (same as addGuest)
        let parsedBody;
        if (lambdaResponse.body) {
          if (typeof lambdaResponse.body === "string") {
            try {
              parsedBody = JSON.parse(lambdaResponse.body);
            } catch (parseError) {
              console.error(
                "❌ Failed to parse Lambda response body:",
                parseError,
              );
              parsedBody = {};
            }
          } else {
            parsedBody = lambdaResponse.body;
          }
        } else {
          parsedBody = lambdaResponse;
        }

        // console.log("🔍 Parsed Lambda Body:", parsedBody);

        // Extract QR data from parsed body (same as addGuest)
        qrSvg = parsedBody?.qrSvg;
        qrCodeUrl = parsedBody?.qrCodeUrl;

        if (qrCodeUrl) {
          guest.qrCode = qrCodeUrl;
          guest.qrCodeData = guest._id.toString();
          qrCodeRegenerated = true;
          // console.log("💾 Saved regenerated QR code to guest");
        } else {
          console.error("❌ QR code generation failed - no URL returned");
        }
      } catch (lambdaError) {
        console.error(
          "❌ Lambda invocation failed for missing QR:",
          lambdaError,
        );
      }
    }
    // Update QR colors only if changed and provided
    else if (qrColorsChanged) {
      if (qrCodeBgColor !== undefined) guest.qrCodeBgColor = qrCodeBgColor;
      if (qrCodeCenterColor !== undefined)
        guest.qrCodeCenterColor = qrCodeCenterColor;
      if (qrCodeEdgeColor !== undefined)
        guest.qrCodeEdgeColor = qrCodeEdgeColor;

      // console.log("🎨 QR colors updated but QR code NOT regenerated (same guest ID)");
    }

    await guest.save();
    // console.log("💾 Guest data saved to database");

    // Ensure PNG is generated and persisted whenever possible
    if (!guest.pngUrl && guest.qrCode) {
      try {
        const pngLambdaName = process.env.PNG_CONVERT_LAMBDA;
        if (!pngLambdaName) {
          console.warn("PNG_CONVERT_LAMBDA not set; skipping PNG conversion");
        } else {
          const pngLambdaResp: any = await invokeLambda(pngLambdaName, {
            guestId: guest._id.toString(),
            eventId: (guest.eventId || eventId) as any,
          });

          let parsedPngResult: any = {};
          try {
            parsedPngResult = pngLambdaResp?.body
              ? typeof pngLambdaResp.body === "string"
                ? JSON.parse(pngLambdaResp.body)
                : pngLambdaResp.body
              : pngLambdaResp || {};
          } catch (parseErr) {
            console.warn(
              "Failed to parse PNG lambda response body:",
              parseErr,
            );
            parsedPngResult = pngLambdaResp || {};
          }

          const pngUrl = parsedPngResult?.pngUrl || parsedPngResult?.url || "";

          if (pngUrl) {
            guest.pngUrl = pngUrl;
            await guest.save();
          }
        }
      } catch (e) {
        console.error("Failed to generate PNG for QR:", e);
      }
    }



    // Use QR code URL (either existing or newly generated)
    qrCodeUrl = guest.qrCode;
    // console.log("📄 Final QR code URL:", qrCodeUrl);

    // Editing a guest never emails them; use "Send Emails" to (re)send.
    const emailSent = false;
    const emailErrorMessage: string | null = null;

    // --- Trigger Backup Lambda (async) ---
    try {
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: process.env.BACKUP_LAMBDA!,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({})),
        }),
      );
    } catch (backupError) {
      console.error("❌ Backup Lambda failed:", backupError);
    }

    res.status(200).json({
      message: qrCodeRegenerated
        ? "Guest updated successfully and QR code regenerated"
        : "Guest updated successfully",
      guest,
      emailSent: emailSent,
      ...(emailErrorMessage ? { emailError: emailErrorMessage } : {}),
      qrCodeAvailable: !!qrCodeUrl,
      qrCodeRegenerated: qrCodeRegenerated,
    });
  } catch (error) {
    console.error("❌ Error in updateGuest:", error);
    res.status(500).json({
      message: "Error updating guest",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const importGuests = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    const eventId = req.body.eventId;
    const userEmail = req.body.userEmail || "softinvites@gmail.com";

    if (!eventId) {
      res.status(400).json({ message: "Missing event ID" });
      return;
    }

    // Upload file to S3
    const fileKey = `uploads/${Date.now()}_${req.file.originalname}`;
    const fileUrl = await uploadToS3(
      req.file.buffer,
      fileKey,
      req.file.mimetype,
    );

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Trigger import Lambda asynchronously
    const forceResend = req.body.forceResend === 'true' || req.body.forceResend === true;

    await invokeLambda(
      process.env.IMPORT_LAMBDA_FUNCTION_NAME!,
      {
        fileUrl,
        eventId,
        userEmail,
        forceResend,
      },
      true,
    );

    res.status(202).json({
      message: forceResend
        ? "Force re-import started. No emails are sent during import; use Send Emails on the guest page."
        : "Import job is running. No emails are sent to guests during import; you will receive a summary when processing completes.",
      fileUrl,
    });
  } catch (error) {
    console.error("Error starting import job:", error);
    res.status(500).json({
      message: "Error starting import job",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};



// New endpoint for QR scanner with timestamp
export const checkInGuest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { checkedInBy } = req.body;

    const guest = await Guest.findById(id);
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    // Update check-in status with timestamp
    guest.checkedIn = true;
    guest.checkedInAt = new Date();
    guest.status = "checked-in";
    if (checkedInBy) {
      guest.checkedInBy = checkedInBy;
    }

    await guest.save();

    res.status(200).json({
      success: true,
      message: "Guest checked in successfully",
      guest: {
        _id: guest._id,
        fullname: guest.fullname,
        TableNo: guest.TableNo,
        checkedIn: guest.checkedIn,
        checkedInAt: guest.checkedInAt,
        checkedInBy: guest.checkedInBy,
        status: guest.status,
      },
    });
  } catch (error) {
    console.error("❌ Error in checkInGuest:", error);
    res.status(500).json({
      message: "Error checking in guest",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const downloadQRCode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const guest = await Guest.findById(id);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    if (guest.pngUrl) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`,
      );
      res.setHeader("Content-Type", "image/png");
      res.redirect(guest.pngUrl);
      return;
    }

    const fallbackPngUrl = buildPngUrl(
      guest.eventId?.toString(),
      guest._id.toString(),
    );
    if (fallbackPngUrl) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`,
      );
      res.setHeader("Content-Type", "image/png");
      res.redirect(fallbackPngUrl);
      return;
    }

    res.status(404).json({ message: "PNG QR code not available" });
  } catch (error) {
    console.error("❌ Error in downloadQRCode:", error);
    res.status(500).json({
      message: "Error downloading QR code",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const downloadAllQRCodes = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;

    const guestCount = await Guest.countDocuments({ eventId });

    if (!guestCount) {
      res.status(404).json({ message: "No guests found" });
      return;
    }

    const bucket = process.env.S3_BUCKET!;
    const region = process.env.AWS_REGION || "us-east-2";

    // Pre-compute a deterministic zip key so we can return it immediately
    const zipKey = `qr_zips/event_${eventId}_pending.zip`;
    const zipUrl = `https://${bucket}.s3.${region}.amazonaws.com/${zipKey}`;

    // Pass eventId only — Lambda fetches its own guest list to stay under 256KB Payload limit
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.ZIP_LAMBDA_FUNCTION_NAME!,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ eventId, zipKey })),
      }),
    );

    res.status(202).json({
      message: "ZIP generation started. Poll the zipDownloadLink until it is available (usually 1–3 minutes for large events).",
      zipDownloadLink: zipUrl,
      guestCount,
      eventId,
      async: true,
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
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { start, end } = req.body;

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

    const qrItems = guests.map((guest) => ({
      guestId: guest._id.toString(),
      guestName: guest.fullname || "Guest",
      tableNo: guest.TableNo || "NoTable",
      others: guest.others || "-",
      pngUrl:
        guest.pngUrl || buildPngUrl(eventId, guest._id.toString()) || "",
    }));

    const lambdaResponse = await invokeLambda(
      process.env.ZIP_LAMBDA_FUNCTION_NAME!,
      {
        qrItems,
        eventId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    );

    const statusCode = lambdaResponse?.statusCode || 500;

    let parsedBody: any = {};
    try {
      parsedBody = lambdaResponse?.body ? JSON.parse(lambdaResponse.body) : {};
    } catch {
      parsedBody = { error: "Failed to parse Lambda response" };
    }

    const zipUrl =
      parsedBody.zipUrl ||
      parsedBody.zipDownloadLink ||
      parsedBody.zipDownloadLink;

    if (statusCode !== 200 || !zipUrl) {
      res.status(statusCode).json({
        message: "Lambda failed to create ZIP archive",
        error: parsedBody?.error || parsedBody?.message || "Unknown Lambda error",
        missingFiles: parsedBody?.missingFiles || [],
      });
      return;
    }

    res.status(200).json({
      zipDownloadLink: zipUrl,
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

export const downloadEmailQRCode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const guest = await Guest.findById(id);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    if (guest.pngUrl) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`,
      );
      res.setHeader("Content-Type", "image/png");
      res.redirect(guest.pngUrl);
      return;
    }

    const fallbackPngUrl = buildPngUrl(
      guest.eventId?.toString(),
      guest._id.toString(),
    );
    if (fallbackPngUrl) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`,
      );
      res.setHeader("Content-Type", "image/png");
      res.redirect(fallbackPngUrl);
      return;
    }

    res.status(404).json({ message: "PNG QR code not available" });
  } catch (error) {
    console.error("❌ Error in downloadEmailQRCode:", error);
    res.status(500).json({
      message: "Error downloading QR code",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const getGuestsByEvent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;

    if (!hasPagination) {
      // Return all guests at once (no pagination)
      const guests = await Guest.find({ eventId })
        .select('-qrCode -qrCodeData -normalizedFullname -message -qrCodeBgColor -qrCodeCenterColor -qrCodeEdgeColor -imported -__v')
        .lean();

      res.status(200).json({
        message: "Successfully fetched all guests for the events",
        guests,
        pagination: {
          total: guests.length,
          page: 1,
          limit: guests.length,
          totalPages: 1,
        },
      });
      return;
    }

    // Backward-compatible paginated path
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
    const skip = (page - 1) * limit;

    const [guests, total] = await Promise.all([
      Guest.find({ eventId })
        .select('-qrCode -qrCodeData -normalizedFullname -message -qrCodeBgColor -qrCodeCenterColor -qrCodeEdgeColor -imported -__v')
        .skip(skip)
        .limit(limit)
        .lean(),
      Guest.countDocuments({ eventId }),
    ]);

    res.status(200).json({
      message: "Successfully fetched all guests for the events",
      guests,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching guests" });
  }
};

export const getGuestById = async (
  req: Request,
  res: Response,
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
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const guest = await Guest.findById(id);

    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    if (guest.qrCode) {
      const url = new URL(guest.qrCode);
      const key = url.pathname.substring(1);
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
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;

    const guests = await Guest.find({ eventId });
    if (!guests.length) {
      res.status(404).json({ message: "No guests found for this event" });
      return;
    }

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

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.BACKUP_LAMBDA!,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({})),
      }),
    );

    res.status(200).json({
      message: "All guests and their QR codes deleted successfully",
      deletedCount: guests.length,
    });
  } catch (error) {
    console.error("Error deleting guests:", error);
    res.status(500).json({ message: "Error deleting guests" });
  }
};

export const deleteGuestsByEventAndTimestamp = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { start, end } = req.body;

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    const guests = await Guest.find({
      eventId,
      createdAt: { $gte: startDate, $lte: endDate },
    });

    if (!guests.length) {
      res.status(404).json({ message: "No guests found for given date range" });
      return;
    }

    if (!start || !end) {
      res
        .status(400)
        .json({ message: "start and end query params are required" });
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
      createdAt: { $gte: startDate, $lte: endDate },
    });

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.BACKUP_LAMBDA!,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({})),
      }),
    );

    res.status(200).json({
      message: `Deleted ${deleteResult.deletedCount} guests for event ${eventId}`,
    });
  } catch (error) {
    console.error("Error deleting guests by event + timestamp:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteSelectedGuests = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { guestIds } = req.body;

    if (!guestIds || !Array.isArray(guestIds) || guestIds.length === 0) {
      res.status(400).json({ message: "Guest IDs array is required" });
      return;
    }

    const guests = await Guest.find({
      _id: { $in: guestIds },
    });

    if (!guests.length) {
      res.status(404).json({ message: "No guests found with provided IDs" });
      return;
    }

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

    const deleteResult = await Guest.deleteMany({
      _id: { $in: guestIds },
    });

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.BACKUP_LAMBDA!,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({})),
      }),
    );

    res.status(200).json({
      message: `Successfully deleted ${deleteResult.deletedCount} guests`,
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting selected guests:", error);
    res.status(500).json({ message: "Error deleting selected guests" });
  }
};

export const scanQRCode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { qrData } = req.body;
    const authHeader = req.headers.authorization;

    if (!qrData) {
      res.status(400).json({ message: "QR Code data is missing" });
      return;
    }

    const guestId = qrData.trim();
    if (!guestId) {
      res.status(400).json({ message: "Invalid QR code format" });
      return;
    }

    const guest = await Guest.findById(guestId);
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    const event = await Event.findById(guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const decodedToken = jwt.verify(
          token,
          process.env.JWT_SECRET as string,
        ) as any;
        const authorizedEventId = decodedToken.eventId;

        if (
          authorizedEventId &&
          guest.eventId.toString() !== authorizedEventId
        ) {
          res.status(403).json({
            message: "This guest belongs to a different event",
            guestEvent: guest.eventId.toString(),
            scannerEvent: authorizedEventId,
          });
          return;
        }
      } catch (tokenError) {
        console.warn(
          "Invalid token provided, continuing without event validation:",
          tokenError,
        );
      }
    }

    const currentStatus = event.getEventStatus();
    if (currentStatus === "expired") {
      res.status(410).json({
        message: "Event has expired. Check-in is no longer available.",
        eventDate: event.date,
        eventStatus: "expired",
      });
      return;
    }

    if (!event.isActive) {
      res.status(403).json({
        message: "Event is not active",
        eventStatus: "inactive",
      });
      return;
    }

    if (guest.checkedIn) {
      res.status(200).json({
        message: "Guest already checked in",
        guest: {
          fullname: guest.fullname,
          TableNo: guest.TableNo,
          others: guest.others,
          checkedInAt: guest.checkedInAt || guest.updatedAt,
        },
      });
      return;
    }

    guest.checkedIn = true;
    guest.status = "checked-in";
    guest.checkedInAt = new Date();
    await guest.save();

    res.status(200).json({
      message: "Guest successfully checked in",
      guest: {
        fullname: guest.fullname,
        TableNo: guest.TableNo,
        others: guest.others,
        checkedIn: guest.checkedIn,
        checkedInAt: guest.checkedInAt,
        status: guest.status,
      },
      event: {
        name: event.name,
        date: event.date,
        location: event.location,
      },
      success: true,
    });
  } catch (error) {
    console.error("🚨 Error during check-in:", error);
    res.status(500).json({ message: "Server error during check-in" });
  }
};

export const generateAnalytics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const totalEvents = await Event.countDocuments();
    const totalGuests = await Guest.countDocuments();
    const checkedInGuests = await Guest.countDocuments({
      checkedIn: true,
    });
    const unusedCodes = totalGuests - checkedInGuests;

    const guestStatusBreakdownRaw = await Guest.aggregate([
      { $match: {} },
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

    const checkInTrendRaw = await Guest.aggregate([
      { $match: {} },
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
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ message: "Invalid event ID format" });
      return;
    }

    const [totalGuests, checkedInGuests] = await Promise.all([
      Guest.countDocuments({ eventId }),
      Guest.countDocuments({ eventId, checkedIn: true }),
    ]);

    if (!totalGuests) {
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

    const unusedCodes = totalGuests - checkedInGuests;

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
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;

    const event = await Event.findById(eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const token = jwt.sign(
      { eventId: eventId, role: "temp", type: "checkin" },
      process.env.JWT_SECRET as string,
      { expiresIn: "72h" },
    );

    const tempLink = `${process.env.FRONTEND_URL}/guest?token=${token}`;
    res.status(200).json({ tempLink });
  } catch (error) {
    console.error("Error generating temp link:", error);
    res.status(500).json({ message: "Error generating temp link" });
  }
};

export const restoreGuestsAndRegenerateQRCodes = async (
  req: Request,
  res: Response,
) => {
  try {
    const { key, eventId } = req.body;

    if (!key || !eventId) {
      return res.status(400).json({
        message: "Both 'key' (S3 path) and 'eventId' are required.",
      });
    }

    console.time("CompleteRestoreProcess");

    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.BACKUP_BUCKET || "softinvites-backups",
      Key: key,
    });

    const s3Response = await s3.send(getObjectCommand);
    if (!s3Response.Body) {
      return res.status(404).json({ message: "Backup file not found in S3." });
    }

    const jsonData = await streamToString(s3Response.Body);
    const allGuests = JSON.parse(jsonData) as any[];
    const eventGuests = allGuests.filter((g) => g.eventId === eventId);

    if (eventGuests.length === 0) {
      return res.status(404).json({
        message: `No guests found for event: ${eventId}`,
      });
    }

    const existingGuests = await Guest.find({
      eventId: new Types.ObjectId(eventId),
    }).lean();
    const existingIds = new Set(existingGuests.map((g) => String(g._id)));

    const guestsToInsert = eventGuests
      .map((guest) => {
        if (guest._id && existingIds.has(String(guest._id))) {
          return null;
        }

        const qrCodeBgColor = guest.qrCodeBgColor || "255,255,255";
        const qrCodeCenterColor = guest.qrCodeCenterColor || "0,0,0";
        const qrCodeEdgeColor = guest.qrCodeEdgeColor || "125,14,43";

        const newGuest = {
          _id: guest._id ? new Types.ObjectId(guest._id) : new Types.ObjectId(),
          ...guest,
          fullname: guest.fullname || "Unknown Guest",
          eventId: new Types.ObjectId(eventId),
          message: guest.message || "-",
          status: guest.status || "pending",
          checkedIn: guest.checkedIn || false,
          imported: guest.imported || true,
          TableNo: guest.TableNo || "-",
          email: guest.email || "",
          phone: guest.phone || "-",
          others: guest.others || "",
          qrCode: "",
          qrCodeData: guest._id ? String(guest._id) : "",
          qrCodeBgColor: qrCodeBgColor,
          qrCodeCenterColor: qrCodeCenterColor,
          qrCodeEdgeColor: qrCodeEdgeColor,
          createdAt: guest.createdAt ? new Date(guest.createdAt) : new Date(),
          updatedAt: guest.updatedAt ? new Date(guest.updatedAt) : new Date(),
        };

        delete newGuest.__v;
        return newGuest;
      })
      .filter((guest) => guest !== null);

    if (guestsToInsert.length === 0) {
      const existingGuestsForQR = await Guest.find({
        eventId: new Types.ObjectId(eventId),
      });
      const qrResults = await regenerateQRCodes(existingGuestsForQR);

      console.timeEnd("CompleteRestoreProcess");

      return res.status(200).json({
        message: `All ${eventGuests.length} guests for event ${eventId} already exist. QR codes regenerated for existing guests.`,
        restoredCount: 0,
        eventId,
        totalFound: eventGuests.length,
      });
    }

    let insertedGuests = [];
    try {
      insertedGuests = await Guest.insertMany(guestsToInsert, {
        ordered: false,
      });
    } catch (insertError: any) {
      console.error("❌ Database insert failed:", insertError);
      throw insertError;
    }

    const allGuestsForQR = await Guest.find({
      eventId: new Types.ObjectId(eventId),
    });
    const qrResults = await regenerateQRCodes(allGuestsForQR);

    console.timeEnd("CompleteRestoreProcess");

    res.status(200).json({
      message: `✅ Complete restore process finished for event ${eventId}`,
      restoredCount: insertedGuests.length,
      qrRegeneration: qrResults,
      eventId,
      totalGuestsInEvent: allGuestsForQR.length,
    });
  } catch (error: any) {
    console.timeEnd("CompleteRestoreProcess");
    console.error("❌ Error in complete restore process:", error);
    res.status(500).json({
      message: "Internal server error during complete restore process.",
      error: error.message,
    });
  }
};

const regenerateQRCodes = async (guests: any[]) => {
  let regeneratedCount = 0;
  let failedCount = 0;

  for (const guest of guests) {
    try {
      const lambdaPayload = {
        guestId: guest._id.toString(),
        fullname: guest.fullname,
        qrCodeBgColor: guest.qrCodeBgColor || "255,255,255",
        qrCodeCenterColor: guest.qrCodeCenterColor || "0,0,0",
        qrCodeEdgeColor: guest.qrCodeEdgeColor || "125,14,43",
        eventId: guest.eventId.toString(),
        TableNo: guest.TableNo || "-",
        others: guest.others || "",
      };

      const lambdaResponse = await invokeLambda(
        process.env.QR_LAMBDA_FUNCTION_NAME!,
        lambdaPayload,
      );

      let parsedBody;
      if (lambdaResponse.body) {
        parsedBody =
          typeof lambdaResponse.body === "string"
            ? JSON.parse(lambdaResponse.body)
            : lambdaResponse.body;
      } else {
        parsedBody = lambdaResponse;
      }

      const qrCodeUrl = parsedBody?.qrCodeUrl;

      if (!qrCodeUrl) {
        throw new Error("No QR code URL returned from Lambda");
      }

      await Guest.updateOne(
        { _id: guest._id },
        {
          $set: {
            qrCode: qrCodeUrl,
            qrCodeData: guest._id.toString(),
            updatedAt: new Date(),
          },
        },
      );

      regeneratedCount++;
    } catch (error: any) {
      failedCount++;
      console.error(`❌ Failed QR generation for ${guest.fullname}:`, error);
    }
  }

  return {
    regeneratedCount,
    failedCount,
    totalProcessed: guests.length,
  };
};

const streamToString = (stream: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
};

export const testDatabase = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;

    const existingGuests = await Guest.find({
      eventId: new Types.ObjectId(eventId),
    }).lean();

    const testGuestData = {
      fullname: "Test Guest " + Date.now(),
      eventId: new Types.ObjectId(eventId),
      TableNo: "-",
      email: "test@example.com",
      phone: "-",
      message: "Test message",
      others: "",
      status: "pending",
      checkedIn: false,
      imported: false,
      qrCode: "",
      qrCodeData: "",
      qrCodeBgColor: "255,255,255",
      qrCodeCenterColor: "0,0,0",
      qrCodeEdgeColor: "0,0,0",
    };

    const testGuest = await Guest.create(testGuestData);
    const verifiedGuest = await Guest.findById(testGuest._id);

    res.status(200).json({
      message: "Database test successful",
      readCount: existingGuests.length,
      writeVerified: !!verifiedGuest,
      testGuestId: testGuest._id,
    });
  } catch (error: any) {
    console.error("❌ Database test failed:", error);
    res.status(500).json({
      message: "Database test failed",
      error: error.message,
    });
  }
};

export const checkQRCodeStatus = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;

    const guests = await Guest.find({
      eventId: new Types.ObjectId(eventId),
    })
      .select("fullname qrCode qrCodeData")
      .lean();

    const results = [];

    for (const guest of guests) {
      let status = "unknown";
      let accessible = false;

      if (guest.qrCode) {
        try {
          const response = await fetch(guest.qrCode, { method: "HEAD" });
          accessible = response.ok;
          status = accessible ? "accessible" : "inaccessible";
        } catch (error) {
          status = "error";
          accessible = false;
        }
      } else {
        status = "missing";
        accessible = false;
      }

      results.push({
        guestId: guest._id.toString(),
        fullname: guest.fullname,
        qrCode: guest.qrCode,
        status,
        accessible,
      });
    }

    const accessibleCount = results.filter((r) => r.accessible).length;
    const inaccessibleCount = results.filter((r) => !r.accessible).length;

    res.status(200).json({
      message: `QR Code Status for event ${eventId}`,
      totalGuests: guests.length,
      accessible: accessibleCount,
      inaccessible: inaccessibleCount,
      results: results.slice(0, 10),
    });
  } catch (error: any) {
    console.error("❌ Error checking QR codes:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const checkZipReady = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;
    const bucket = process.env.S3_BUCKET!;
    const zipKey = `qr_zips/event_${eventId}_pending.zip`;

    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: zipKey }));

    const region = process.env.AWS_REGION || "us-east-2";
    res.status(200).json({
      ready: true,
      zipDownloadLink: `https://${bucket}.s3.${region}.amazonaws.com/${zipKey}`,
    });
  } catch {
    res.status(200).json({ ready: false });
  }
};

export const resendAllEmails = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      res.status(400).json({ message: "Event ID is required" });
      return;
    }

    const event = await Event.findById(eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    // Optional: only the guests selected on the guest page.
    const guestIds: string[] | null = Array.isArray(req.body?.guestIds)
      ? req.body.guestIds.filter((id: unknown) =>
          typeof id === "string" && mongoose.Types.ObjectId.isValid(id),
        )
      : null;
    if (Array.isArray(req.body?.guestIds) && !guestIds?.length) {
      res.status(400).json({ message: "No valid guests selected" });
      return;
    }

    const guestsWithEmail = await Guest.countDocuments({
      eventId,
      email: { $exists: true, $ne: "" },
      ...(guestIds ? { _id: { $in: guestIds } } : {}),
    });

    if (guestsWithEmail === 0) {
      res.status(404).json({
        message: guestIds
          ? "None of the selected guests has an email address"
          : "No guests with email addresses found",
      });
      return;
    }

    await invokeLambda(
      process.env.RESEND_EMAILS_LAMBDA_FUNCTION_NAME!,
      { eventId, ...(guestIds ? { guestIds } : {}) },
      true,
    );

    res.status(202).json({
      message: `Sending emails to ${guestsWithEmail} guest${guestsWithEmail === 1 ? "" : "s"}. Admin will receive a notification when complete.`,
      eventName: event.name,
      guestsWithEmail,
    });
  } catch (error) {
    console.error("❌ Error starting resend emails job:", error);
    res.status(500).json({
      message: "Error starting resend emails job",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
