import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
import QRCode from "qrcode-svg";
import { invokeLambda } from '../utils/lambdaUtils';
import { uploadToS3, deleteFromS3 } from '../utils/s3Utils';
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";
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
    const iv = event.iv;
    
    // --- Create Guest (no QR yet) ---
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

    console.log("📤 Sending to Lambda:", lambdaPayload);

    let lambdaResponse;
    try {
      lambdaResponse = await invokeLambda(process.env.QR_LAMBDA_FUNCTION_NAME!, lambdaPayload);
      console.log("✅ Lambda Response Received:", JSON.stringify(lambdaResponse, null, 2));
    } catch (lambdaError) {
      console.error("❌ Lambda invocation failed:", lambdaError);
      lambdaResponse = {};
    }

    let qrSvg = lambdaResponse?.qrSvg;
    let qrCodeUrl = lambdaResponse?.qrCodeUrl;

    console.log("🔍 QR Code Analysis:", {
      hasSvg: !!qrSvg,
      svgType: typeof qrSvg,
      svgLength: qrSvg?.length,
      svgPreview: qrSvg?.substring(0, 100),
      hasUrl: !!qrCodeUrl,
      url: qrCodeUrl ? qrCodeUrl.substring(0, 100) + "..." : undefined
    });

    // --- Save QR info to DB ---
    savedGuest.qrCodeData = savedGuest._id.toString();
    savedGuest.qrCode = qrCodeUrl || "";
    await savedGuest.save();
    console.log("💾 QR data saved to database");

    // --- Email Sending ---
    if (email) {
      try {
        const sanitizedMessage = sanitizeHtml(message, {
          allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br", "h1", "h2"],
          allowedAttributes: {},
        });

        console.log("📧 Email QR Status:", {
          hasS3Url: !!qrCodeUrl,
          s3Url: qrCodeUrl
        });

        let qrImgTag;
        
        // Use S3 URL directly in email
        if (qrCodeUrl) {
          qrImgTag = `
            <div style="text-align: center; margin: 20px 0;">
              <img src="${qrCodeUrl}" 
                   alt="[SHOW IMAGES] Your Event QR Code - Required for Entry at ${eventName}" 
                   width="200" height="200" 
                   style="margin: 15px auto; border: 2px solid #7d0e2b; display: block; border-radius: 8px;" />
              
              <div style="background: #fff5f5; padding: 15px; margin: 15px 0; border-radius: 8px; border: 1px solid #ff6b6b;">
                <p style="color: #d63031; font-weight: bold; margin: 0 0 10px 0; text-align: center;">
                  ⚠️ Can't see the QR code above?
                </p>
                <p style="text-align: center; margin: 0;">
                  <a href="${qrCodeUrl}" 
                     style="color: #ffffff; background-color: #7d0e2b; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin: 5px;">
                     🔍 CLICK TO VIEW YOUR QR CODE
                  </a>
                </p>
                <p style="color: #666; font-size: 12px; text-align: center; margin: 10px 0 0 0;">
                  Or look for "Display images" or "Load external content" in your email client
                </p>
              </div>
            </div>
          `;
          console.log("✅ Using S3 URL in email HTML");
        } else {
          qrImgTag = `
            <div style="border: 2px solid #ff6b6b; padding: 15px; margin: 10px 0; text-align: center; background: #fff5f5;">
              <p style="color: #d63031; margin: 0; font-weight: bold;">QR CODE NOT AVAILABLE</p>
              <p style="color: #d63031; margin: 5px 0 0 0; font-size: 12px;">Please contact the event organizer</p>
            </div>
          `;
          console.error("❌ No QR code URL available for email");
        }

        const emailContent = `
          <div style="font-family: 'Georgia', serif; color: #000; background-color: #fff; padding: 20px; max-width: 600px; margin: 0 auto;">
            <!-- IMPORTANT WARNING BANNER -->
            <div style="background: #fff5f5; border: 2px solid #ff6b6b; border-radius: 8px; padding: 15px; margin-bottom: 25px; text-align: center;">
              <p style="color: #d63031; margin: 0; font-weight: bold; font-size: 14px;">
                🔍 IMPORTANT: Enable images to view your QR code event pass
              </p>
              <p style="color: #666; margin: 5px 0 0 0; font-size: 12px;">
                Most email providers block images by default for security
              </p>
            </div>
            
            <h2 style="text-align: center; font-weight: bold; font-size: 24px; margin-bottom: 10px; color: #7d0e2b;">${eventName}</h2>
            <hr style="border: none; border-top: 2px solid #7d0e2b; margin: 10px auto; width: 80%;" />

            <div style="text-align: center; margin: 30px 0;">
              <img src="${iv}" alt="Event Invitation" width="400" style="border: 10px solid #7d0e2b; border-radius: 8px; max-width: 100%;" />
            </div>

            <p style="font-size: 16px; line-height: 1.6;">Dear <strong style="color: #7d0e2b;">${fullname}</strong>,</p>
            <p style="font-weight: bold; font-size: 16px; line-height: 1.6; background: #fff5f5; padding: 15px; border-radius: 5px;">${sanitizedMessage}</p>

            <p style="font-weight: bold; margin-top: 30px; font-size: 14px; color: #555;">
              Please note: This event is strictly by invitation and this invitation is uniquely intended for you. 
              A personalised QR code is provided below.
            </p>
            <p style="font-size: 14px; line-height: 1.6;">Kindly acknowledge receipt of this e-invitation. We look forward to welcoming you at the event.</p>
            <p style="font-style: italic; color: #666; text-align: center; margin: 20px 0;">Message powered by SoftInvites.</p>

            <!-- ENHANCED QR CODE SECTION -->
            <div style="text-align: center; margin: 40px 0; padding: 25px; background: #f8f9fa; border-radius: 10px; border: 2px dashed #7d0e2b;">
              <p style="font-weight: bold; font-size: 20px; color: #7d0e2b; margin-bottom: 20px;">
                🎟️ YOUR EVENT PASS - QR CODE REQUIRED FOR ENTRY
              </p>
              
              ${qrImgTag}
              
              <div style="font-size: 10px; color: #999; margin-top: 15px; padding: 10px; background: #fff; border-radius: 5px;">
                Guest: ${fullname} | Table: ${TableNo || 'N/A'} | ID: ${savedGuest._id.toString().substring(0, 8)}
              </div>
            </div>

            <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; text-align: center; font-size: 12px; color: #666;">
              <p><strong>SoftInvites</strong><br />Lagos, Nigeria</p>
              <p style="margin-top: 10px;">
                You received this email because you have been invited to this event.<br />
              </p>
            </footer>
          </div>
        `;

        console.log("📤 Sending email to:", email);
        
        // Send email WITHOUT attachments - QR code is embedded via S3 URL
        await sendEmail(
          email, 
          `${eventName} - Invitation`,
          emailContent
        );

        
        console.log(`✅ Email sent to ${email}`);

      } catch (emailError) {
        console.error("❌ Failed to send email:", emailError);
      }
    }

    // --- Trigger Backup Lambda (async) ---
    try {
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: process.env.BACKUP_LAMBDA!,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({})),
        })
      );
    } catch (backupError) {
      console.error("❌ Backup Lambda failed:", backupError);
    }

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
    const userEmail = req.body.userEmail || "softinvites@gmail.com";
    
    if (!eventId) {
      res.status(400).json({ message: "Missing event ID" });
      return;
    }

    // Upload file to S3
    const fileKey = `uploads/${Date.now()}_${req.file.originalname}`;
    const fileUrl = await uploadToS3(req.file.buffer, fileKey, req.file.mimetype);

    console.log("📤 Uploaded file to S3:", fileKey);
    console.log("🔗 File URL:", fileUrl);

    // Wait 3 seconds for S3 consistency AND to ensure file is fully uploaded
    console.log("⏳ Waiting for S3 consistency and file availability...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Trigger import Lambda asynchronously
    await invokeLambda(
      process.env.IMPORT_LAMBDA_FUNCTION_NAME!,
      { 
        fileUrl, 
        eventId, 
        userEmail 
      }, 
      true 
    );

    res.status(202).json({
      message: "Import job is running. You will receive an email when processing completes.",
      fileUrl
    });

  } catch (error) {
    console.error("Error starting import job:", error);
    res.status(500).json({
      message: "Error starting import job",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const updateGuest = async (req: Request, res: Response): Promise<void> => {
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

    // DEBUG: Check guest QR code status BEFORE any updates
    console.log("🔍 Guest QR Code Status BEFORE Update:", {
      guestId: guest._id.toString(),
      hasQrCode: !!guest.qrCode,
      qrCode: guest.qrCode,
      hasQrCodeData: !!guest.qrCodeData,
      qrCodeData: guest.qrCodeData
    });

    // --- Check Event Existence ---
    const event = await Event.findById(eventId || guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const iv = event.iv;

    // Store original values for comparison
    const originalEmail = guest.email;
    const emailChanged = email !== undefined && email !== originalEmail;

    // Check if QR colors changed (only if provided in request)
    const qrColorsChanged = (
      (qrCodeBgColor !== undefined && qrCodeBgColor !== guest.qrCodeBgColor) ||
      (qrCodeCenterColor !== undefined && qrCodeCenterColor !== guest.qrCodeCenterColor) ||
      (qrCodeEdgeColor !== undefined && qrCodeEdgeColor !== guest.qrCodeEdgeColor)
    );

    // Update guest fields only if provided (proper optional field handling)
    if (fullname !== undefined) guest.fullname = fullname;
    if (TableNo !== undefined) guest.TableNo = TableNo;
    if (email !== undefined) guest.email = email;
    if (phone !== undefined) guest.phone = phone;
    if (message !== undefined) {
      guest.message = sanitizeHtml(message, {
        allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br", "h1", "h2"],
        allowedAttributes: {},
      });
    }
    if (others !== undefined) guest.others = others;

    let qrCodeUrl = guest.qrCode;
    let qrCodeRegenerated = false;

    // --- REGENERATE QR CODE IF MISSING ---
    if (!guest.qrCode) {
      console.log("🔄 QR code missing in database, generating now...");
      
      // Set colors if provided, otherwise use existing or defaults
      if (qrCodeBgColor !== undefined) guest.qrCodeBgColor = qrCodeBgColor;
      if (qrCodeCenterColor !== undefined) guest.qrCodeCenterColor = qrCodeCenterColor;
      if (qrCodeEdgeColor !== undefined) guest.qrCodeEdgeColor = qrCodeEdgeColor;
      
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
        phone: guest.phone,
        others: guest.others,
      };

      console.log("📤 Generating missing QR code:", lambdaPayload);

      let lambdaResponse;
      try {
        lambdaResponse = await invokeLambda(process.env.QR_LAMBDA_FUNCTION_NAME!, lambdaPayload);
        console.log("✅ Lambda Response for missing QR:", JSON.stringify(lambdaResponse, null, 2));
        
        qrCodeUrl = lambdaResponse?.qrCodeUrl;
        
        if (qrCodeUrl) {
          guest.qrCode = qrCodeUrl;
          guest.qrCodeData = guest._id.toString();
          qrCodeRegenerated = true;
          console.log("💾 Saved regenerated QR code to guest");
        } else {
          console.error("❌ QR code generation failed - no URL returned");
        }
      } catch (lambdaError) {
        console.error("❌ Lambda invocation failed for missing QR:", lambdaError);
      }
    } 
    // Update QR colors only if changed and provided
    else if (qrColorsChanged) {
      if (qrCodeBgColor !== undefined) guest.qrCodeBgColor = qrCodeBgColor;
      if (qrCodeCenterColor !== undefined) guest.qrCodeCenterColor = qrCodeCenterColor;
      if (qrCodeEdgeColor !== undefined) guest.qrCodeEdgeColor = qrCodeEdgeColor;
      
      console.log("🎨 QR colors updated but QR code NOT regenerated (same guest ID)");
    }

    await guest.save();
    console.log("💾 Guest data saved to database");

    // Use QR code URL (either existing or newly generated)
    qrCodeUrl = guest.qrCode;
    console.log("📄 Final QR code URL:", qrCodeUrl);

    // --- Email Sending ---
    // Send email if email changed OR QR was regenerated OR colors changed OR message changed
    const shouldSendEmail = (
      emailChanged || 
      qrCodeRegenerated || 
      qrColorsChanged || 
      (message !== undefined && message !== guest.message)
    ) && guest.email;
    
    if (shouldSendEmail) {
      try {
        console.log("📧 Email Details:", {
          hasS3Url: !!qrCodeUrl,
          emailChanged,
          qrColorsChanged,
          qrCodeRegenerated,
          messageChanged: message !== undefined && message !== guest.message,
          s3Url: qrCodeUrl
        });

        let qrImgTag;
        
        // Use S3 URL directly in email
        if (qrCodeUrl) {
          qrImgTag = `
            <div style="text-align: center; margin: 20px 0;">
              <img src="${qrCodeUrl}" 
                   alt="[SHOW IMAGES] Your Event QR Code - Required for Entry at ${eventName}" 
                   width="200" height="200" 
                   style="margin: 15px auto; border: 2px solid #7d0e2b; display: block; border-radius: 8px;" />
              
              <div style="background: #fff5f5; padding: 15px; margin: 15px 0; border-radius: 8px; border: 1px solid #ff6b6b;">
                <p style="color: #d63031; font-weight: bold; margin: 0 0 10px 0; text-align: center;">
                  ⚠️ Can't see the QR code above?
                </p>
                <p style="text-align: center; margin: 0;">
                  <a href="${qrCodeUrl}" 
                     style="color: #ffffff; background-color: #7d0e2b; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin: 5px;">
                     🔍 CLICK TO VIEW YOUR QR CODE
                  </a>
                </p>
                <p style="color: #666; font-size: 12px; text-align: center; margin: 10px 0 0 0;">
                  Or look for "Display images" or "Load external content" in your email client
                </p>
              </div>
            </div>
          `;
          console.log("✅ Using S3 URL in email HTML");
        } else {
          qrImgTag = `
            <div style="border: 2px solid #ff6b6b; padding: 15px; margin: 10px 0; text-align: center; background: #fff5f5;">
              <p style="color: #d63031; margin: 0; font-weight: bold;">QR CODE NOT AVAILABLE</p>
              <p style="color: #d63031; margin: 5px 0 0 0; font-size: 12px;">Please contact the event organizer</p>
            </div>
          `;
          console.error("❌ No QR code URL available for email");
        }

        const emailContent = `
          <div style="font-family: 'Georgia', serif; color: #000; background-color: #fff; padding: 20px; max-width: 600px; margin: 0 auto;">
            <!-- IMPORTANT WARNING BANNER -->
            <div style="background: #fff5f5; border: 2px solid #ff6b6b; border-radius: 8px; padding: 15px; margin-bottom: 25px; text-align: center;">
              <p style="color: #d63031; margin: 0; font-weight: bold; font-size: 14px;">
                🔍 IMPORTANT: Enable images to view your QR code event pass
              </p>
              <p style="color: #666; margin: 5px 0 0 0; font-size: 12px;">
                Most email providers block images by default for security
              </p>
            </div>
            
            <h2 style="text-align: center; font-weight: bold; font-size: 24px; margin-bottom: 10px; color: #7d0e2b;">${eventName}</h2>
            <hr style="border: none; border-top: 2px solid #7d0e2b; margin: 10px auto; width: 80%;" />

            <div style="text-align: center; margin: 30px 0;">
              <img src="${iv}" alt="Event Invitation" width="400" style="border: 10px solid #7d0e2b; border-radius: 8px; max-width: 100%;" />
            </div>

            <p style="font-size: 16px; line-height: 1.6;">Dear <strong style="color: #7d0e2b;">${guest.fullname}</strong>,</p>
            <p style="font-weight: bold; font-size: 16px; line-height: 1.6; background: #fff5f5; padding: 15px; border-radius: 5px;">${guest.message}</p>

            <p style="font-weight: bold; margin-top: 30px; font-size: 14px; color: #555;">
              Please note: This event is strictly by invitation and this invitation is uniquely intended for you. 
              ${qrCodeRegenerated ? 'Your QR code has been generated.' : qrColorsChanged ? 'Your invitation details have been updated.' : 'Your invitation has been updated.'}
            </p>
            <p style="font-size: 14px; line-height: 1.6;">Kindly acknowledge receipt of this e-invitation. We look forward to welcoming you at the event.</p>
            <p style="font-style: italic; color: #666; text-align: center; margin: 20px 0;">Message powered by SoftInvites.</p>

            <!-- ENHANCED QR CODE SECTION -->
            <div style="text-align: center; margin: 40px 0; padding: 25px; background: #f8f9fa; border-radius: 10px; border: 2px dashed #7d0e2b;">
              <p style="font-weight: bold; font-size: 20px; color: #7d0e2b; margin-bottom: 20px;">
                🎟️ YOUR EVENT PASS - QR CODE REQUIRED FOR ENTRY
              </p>
              
              ${qrImgTag}
              
              <div style="font-size: 10px; color: #999; margin-top: 15px; padding: 10px; background: #fff; border-radius: 5px;">
                Guest: ${guest.fullname} | Table: ${guest.TableNo || 'N/A'} | ID: ${guest._id.toString().substring(0, 8)}
              </div>
            </div>

            <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; text-align: center; font-size: 12px; color: #666;">
              <p><strong>SoftInvites</strong><br />Lagos, Nigeria</p>
              <p style="margin-top: 10px;">
                You received this email because you have been invited to this event.<br />
              </p>
            </footer>
          </div>
        `;

        console.log("📤 Sending email to:", guest.email);
        
        // Send email using QR code
        await sendEmail(
          guest.email,
          `${eventName} - Invitation`,
          emailContent
        );
        
        console.log(`✅ Email sent to ${guest.email}`);

      } catch (emailError) {
        console.error("❌ Failed to send email:", emailError);
      }
    }

    res.status(200).json({
      message: qrCodeRegenerated 
        ? "Guest updated successfully and QR code regenerated" 
        : "Guest updated successfully",
      guest,
      emailSent: shouldSendEmail,
      qrCodeAvailable: !!qrCodeUrl,
      qrCodeRegenerated: qrCodeRegenerated
    });

  } catch (error) {
    console.error("❌ Error in updateGuest:", error);
    res.status(500).json({
      message: "Error updating guest",
      error: error instanceof Error ? error.message : error,
    });
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

    // 👇 Safe filename logic
    const safeName = guest.fullname?.replace(/[^a-zA-Z0-9-_]/g, "_") || "guest";
    const safeTableNo =
      guest.TableNo?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noTable";
    const safeOthers =
      guest.others?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noOthers";
    const guestId = guest._id.toString();

    const filename = `qr-${safeName}_${safeTableNo}_${safeOthers}_${guestId}.png`;

    // ✅ Encode PNG buffer to Base64
    const base64Data = pngBuffer.toString("base64");

    // ✅ Send response in API Gateway–compatible format
    res.send({
      isBase64Encoded: true,
      statusCode: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      body: base64Data,
    });
  } catch (error) {
    console.error("❌ QR download error:", error);
    res.status(500).json({
      message: "Error downloading QR code",
      error: error
    });
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

const qrItems = guests
  .map((guest) => {
    try {
      if (!guest.qrCode || typeof guest.qrCode !== "string") return null;

      const url = new URL(guest.qrCode);
      const path = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;

      if (!path.endsWith(".svg")) return null;

      return {
        key: path,
        guestId: guest._id.toString(),        
        guestName: guest.fullname || "Guest",
        tableNo: guest.TableNo || "NoTable",
        others: guest.others || "-",        
        qrCodeBgColor: guest.qrCodeBgColor || "255,255,255",  
        qrCodeCenterColor: guest.qrCodeCenterColor || "0,0,0",
        qrCodeEdgeColor: guest.qrCodeEdgeColor || "0,0,0",
      };
    } catch {
      return null;
    }
  })
  .filter(Boolean) as {
    key: string;
    guestId: string;
    guestName: string;
    tableNo: string;
    others: string;
    qrCodeBgColor: string;
    qrCodeCenterColor: string;
    qrCodeEdgeColor: string;
  }[];


    if (!qrItems.length) {
      res.status(400).json({ message: "No valid QR code paths found" });
      return;
    }

    const lambdaResponse = await invokeLambda(process.env.ZIP_LAMBDA_FUNCTION_NAME!, {
      qrItems,
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

    const qrItems = guests
      .map((guest) => {
        try {
          if (!guest.qrCode || typeof guest.qrCode !== "string") return null;

          const url = new URL(guest.qrCode);
          const path = url.pathname.startsWith("/")
            ? url.pathname.slice(1)
            : url.pathname;

          if (!path.endsWith(".svg")) return null;

          return {
            key: path,
            guestId: guest._id.toString(),
            guestName: guest.fullname || "Guest",
            tableNo: guest.TableNo || "NoTable",
            others: guest.others || "-",
            qrCodeBgColor: guest.qrCodeBgColor || "255,255,255",
            qrCodeCenterColor: guest.qrCodeCenterColor || "0,0,0",
            qrCodeEdgeColor: guest.qrCodeEdgeColor || "0,0,0",
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as {
        key: string;
        guestId: string;
        guestName: string;
        tableNo: string;
        others: string;
        qrCodeBgColor: string;
        qrCodeCenterColor: string;
        qrCodeEdgeColor: string;
      }[];

    if (!qrItems.length) {
      res.status(400).json({ message: "No valid QR code paths found in the given range" });
      return;
    }

    const lambdaResponse = await invokeLambda(process.env.ZIP_LAMBDA_FUNCTION_NAME!, {
      qrItems,
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

export const downloadEmailQRCode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    console.log("📥 Download request for guest ID:", id);

    const guest = await Guest.findById(id);
    if (!guest) {
      console.log("❌ Guest not found:", id);
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    console.log("✅ Guest found:", guest.fullname);

    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

    console.log("🎨 Colors:", { bgColorHex, centerColorHex, edgeColorHex });

    // Generate QR code
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
    console.log("✅ SVG generated, length:", svg.length);

    // Add gradient styling
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

    console.log("🔄 Converting SVG to PNG...");

    // Fix for Sharp conversion - ensure proper SVG input
    try {
      // Clean the SVG and ensure it's valid
      const cleanSvg = svg.trim();
      
      // Convert SVG to PNG with proper error handling
      const pngBuffer = await sharp(Buffer.from(cleanSvg), {
        density: 300 // Higher density for better quality
      })
        .resize(512, 512, { 
          fit: "contain",
          background: bgColorHex
        })
        .png({ 
          compressionLevel: 9, 
          adaptiveFiltering: true,
          force: true
        })
        .toBuffer();

      console.log("✅ PNG conversion successful, buffer size:", pngBuffer.length);

      // Safe filename logic
      const safeName = guest.fullname?.replace(/[^a-zA-Z0-9-_]/g, "_") || "guest";
      const safeTableNo = guest.TableNo?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noTable";
      const safeOthers = guest.others?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noOthers";
      const guestId = guest._id.toString();

      const filename = `qr-${safeName}_${safeTableNo}_${safeOthers}_${guestId}.png`;

      console.log("📁 Filename:", filename);

      // Return in API Gateway format for Lambda
      res.send({
        isBase64Encoded: true,
        statusCode: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
        body: pngBuffer.toString("base64"),
      });

    } catch (sharpError) {
      console.error("❌ Sharp conversion error:", sharpError);
      
      // Fallback: Return the SVG directly
      console.log("🔄 Falling back to SVG format");
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="qr-${guest.fullname}.svg"`);
      res.send(svg);
    }

  } catch (error) {
    console.error("❌ Error in downloadEmailQRCode:", error);
    res.status(500).json({ 
      message: "Error downloading QR code",
      error: error instanceof Error ? error.message : 'Unknown error'
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
