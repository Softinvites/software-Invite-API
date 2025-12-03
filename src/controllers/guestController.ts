import { Request, Response } from "express";
import { Guest } from "../models/guestmodel";
import { Event } from "../models/eventmodel";
import { invokeLambda } from '../utils/lambdaUtils';
import { uploadToS3, deleteFromS3 } from '../utils/s3Utils';
import { createGuestSchema, updateGuestSchema, option } from "../utils/utils";
import { sendEmail } from "../library/helpers/emailService";
import { rgbToHex } from "../utils/colorUtils";
import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";
import sanitizeHtml from "sanitize-html";
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-2" });
 

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

// Helper function to adjust color brightness
const adjustColorBrightness = (hex: string, percent: number): string => {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
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

// console.log("📤 Sending to Lambda:", lambdaPayload);

let qrSvg, qrCodeUrl;

try {
  const lambdaResponse = await invokeLambda(process.env.QR_LAMBDA_FUNCTION_NAME!, lambdaPayload);
  // Parse the nested response structure
  let parsedBody;
  if (lambdaResponse.body) {
    if (typeof lambdaResponse.body === 'string') {
      try {
        parsedBody = JSON.parse(lambdaResponse.body);
      } catch (parseError) {
        console.error("❌ Failed to parse Lambda response body:", parseError);
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
await savedGuest.save();

    // --- Save QR info to DB ---
    savedGuest.qrCodeData = savedGuest._id.toString();
    savedGuest.qrCode = qrCodeUrl || "";
    await savedGuest.save();

    // --- Email Sending ---
    if (email) {
      try {
        const sanitizedMessage = sanitizeHtml(message, {
          allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br", "h1", "h2"],
          allowedAttributes: {},
        });

        // Convert SVG to PNG for email compatibility using pngConvertLambda
        let pngQrCodeUrl = "";
        if (qrCodeUrl) {
          try {
            const lambdaResponse = await invokeLambda(process.env.PNG_CONVERT_LAMBDA!, {
              guestId: savedGuest._id.toString(),
              eventId: eventId
            });
            
            const parsedBody = typeof lambdaResponse.body === 'string' 
              ? JSON.parse(lambdaResponse.body) 
              : lambdaResponse.body;
            
            pngQrCodeUrl = parsedBody?.pngUrl || "";
          } catch (pngError) {
            console.error("❌ PNG conversion failed:", pngError);
          }
        }
        
        const finalQrUrl = pngQrCodeUrl || qrCodeUrl;
        const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${savedGuest._id.toString()}`;

        // Get QR center color for header and determine text color
        const centerColorHex = rgbToHex(qrCodeCenterColor || "0,0,0");
        const darkerCenterColor = adjustColorBrightness(centerColorHex, -20);
        
        // Simple text color logic: white for dark colors, black for light colors
        const num = parseInt(centerColorHex.replace("#", ""), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 180 ? "#000000" : "#ffffff";
        
        // Create beautiful, mature invitation email design
        const emailContent = `
          <div style="font-family: 'Segoe UI', 'Arial', sans-serif; background: #f7f8fc; padding: 20px 10px; margin: 0; line-height: 1.6;">
            <div style="width: 100%; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
              
              <!-- Header Section -->
              <div style="background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); padding: 40px 20px; text-align: center;">
                <h1 style="color: ${textColor}; font-size: clamp(24px, 5vw, 32px); font-weight: 600; margin: 0 0 8px 0; letter-spacing: 0.5px;">${eventName}</h1>
                <p style="color: ${textColor}; font-size: clamp(14px, 3vw, 18px); margin: 0; opacity: 0.9;">${eventDate}</p>
              </div>

              <!-- Main Content -->
              <div style="padding: 30px 20px;">
                
                <!-- Personal Greeting -->
                <div style="margin-bottom: 30px;">
                  <div style="background: #f8faff; padding: 20px; border-radius: 8px;">
                    <p style="font-size: clamp(16px, 4vw, 18px); margin: 0 0 12px 0; font-weight: 600; color: ${darkerCenterColor};">Dear ${fullname},</p>
                    <div style="font-size: clamp(14px, 3.5vw, 16px); color: #4a5568; line-height: 1.7;">
                      ${sanitizedMessage}
                    </div>
                  </div>
                </div>

                <!-- QR Code Section -->
                <div style="text-align: center; background: linear-gradient(135deg, #f8faff 0%, #e8f2ff 100%); padding: 30px 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
                  <h2 style="color: ${centerColorHex}; font-size: clamp(18px, 4vw, 22px); font-weight: 600; margin: 0 0 25px 0;">🎟️ Your Digital Pass</h2>
                  
                  <div style="background: #ffffff; padding: clamp(30px, 6vw, 50px); border-radius: 12px; display: inline-block; box-shadow: 0 4px 16px rgba(30,60,114,0.1); border: 1px solid #e2e8f0;">
                    ${finalQrUrl ? `
                      <img src="${finalQrUrl}" 
                           alt="Your Event QR Code" 
                           width="300" height="300"
                           style="display: block; border-radius: 8px; max-width: 100%; height: auto;" />
                    ` : `
                      <div style="width: 300px; height: 300px; background: #f7f8fc; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 2px dashed #cbd5e0; max-width: 100%;">
                        <p style="color: #718096; margin: 0; font-size: 14px; text-align: center;">Loading QR Code...</p>
                      </div>
                    `}
                  </div>
                  
                  <p style="color: #718096; font-size: clamp(12px, 3vw, 14px); margin: 20px 0 25px 0;">Present this code at the event entrance for quick check-in</p>
                  
                  <a href="${downloadUrl}" 
                     style="display: inline-block; background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); color: ${textColor}; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: clamp(12px, 3vw, 14px); box-shadow: 0 4px 12px rgba(30,60,114,0.3); transition: all 0.3s ease;">
                     Download QR Code
                  </a>
                </div>

                <!-- Important Notice -->
                <div style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: #ffffff; padding: 20px; border-radius: 10px; margin: 30px 0 0 0; text-align: center;">
                  <p style="font-size: 15px; font-weight: 600; margin: 0 0 5px 0;">Invitation Confirmed</p>
                  <p style="font-size: 13px; margin: 0; opacity: 0.9;">This invitation is exclusively for you. Please keep your QR code secure.</p>
                </div>
              </div>

              <!-- Footer -->
              <div style="background: #f7f8fc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #718096; margin: 0;">© 2025 <strong style="color: #4a5568;">SoftInvites</strong> • All rights reserved</p>
              </div>
            </div>
          </div>
`;

        // console.log("📤 Sending email to:", email);
        
        // Prepare attachments array
        const attachments = [];
        
        // Add event IV as attachment if it exists
        if (iv) {
          try {
            // Download the image from URL to get Buffer
            const imageResponse = await fetch(iv);
            if (imageResponse.ok) {
              const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
              attachments.push({
                filename: `${eventName.replace(/[^a-zA-Z0-9]/g, '_')}_invitation.jpg`,
                content: imageBuffer,
                contentType: 'image/jpeg'
              });
            }
          } catch (attachmentError) {
            console.error("❌ Failed to download event IV for attachment:", attachmentError);
          }
        }
        
        // Send email with event IV attachment
        await sendEmail(
          email, 
          `Invitation to ${eventName}`,
          emailContent,
          `${eventName} <info@softinvite.com>`,
          attachments.length > 0 ? attachments : undefined
        );

        
        // console.log(`✅ Email sent to ${email}`);

      } catch (emailError) {
        console.error("Failed to send email:", emailError);
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
      console.error("Backup Lambda failed:", backupError);
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


    // --- Check Event Existence ---
    const event = await Event.findById(eventId || guest.eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }

    const eventName = event.name;
    const eventDate = event.date;
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
      // console.log("🔄 QR code missing in database, generating now...");
      
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
        others: guest.others,
      };

      // console.log("📤 Generating missing QR code:", lambdaPayload);

      let qrSvg, lambdaResponse;
      try {
        lambdaResponse = await invokeLambda(process.env.QR_LAMBDA_FUNCTION_NAME!, lambdaPayload);
        // console.log("✅ Lambda Response for missing QR:", JSON.stringify(lambdaResponse, null, 2));
        
        // Parse the nested response structure (same as addGuest)
        let parsedBody;
        if (lambdaResponse.body) {
          if (typeof lambdaResponse.body === 'string') {
            try {
              parsedBody = JSON.parse(lambdaResponse.body);
            } catch (parseError) {
              console.error("❌ Failed to parse Lambda response body:", parseError);
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
        console.error("❌ Lambda invocation failed for missing QR:", lambdaError);
      }
    } 
    // Update QR colors only if changed and provided
    else if (qrColorsChanged) {
      if (qrCodeBgColor !== undefined) guest.qrCodeBgColor = qrCodeBgColor;
      if (qrCodeCenterColor !== undefined) guest.qrCodeCenterColor = qrCodeCenterColor;
      if (qrCodeEdgeColor !== undefined) guest.qrCodeEdgeColor = qrCodeEdgeColor;
      
      // console.log("🎨 QR colors updated but QR code NOT regenerated (same guest ID)");
    }

    await guest.save();
    // console.log("💾 Guest data saved to database");

    // Use QR code URL (either existing or newly generated)
    qrCodeUrl = guest.qrCode;
    // console.log("📄 Final QR code URL:", qrCodeUrl);

    // --- Email Sending (ONLY if email is updated) ---
    let emailSent = false;
    if (emailChanged && guest.email) {
      try {
        const sanitizedMessage = sanitizeHtml(guest.message, {
          allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br", "h1", "h2"],
          allowedAttributes: {},
        });



        let qrImgTag;
        
        // Use S3 URL directly in email (updated to match addGuest)
        if (qrCodeUrl) {
          qrImgTag = `
            <div style="background: #fff; padding: 20px; border-radius: 12px; display: inline-block; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <img src="${qrCodeUrl}" 
                   alt="Your Event QR Code" 
                   width="180" height="180" 
                   style="display: block; border-radius: 8px;" />
            </div>
            
            <div style="margin-top: 20px;">
              <a href="${qrCodeUrl}" 
                 style="display: inline-block; background: #3498db; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px;">
                 Download QR Code
              </a>
            </div>
          `;
          // console.log("✅ Using S3 URL in email HTML");
        } else {
          qrImgTag = `
            <div style="border: 2px solid #ff6b6b; padding: 15px; margin: 10px 0; text-align: center; background: #fff5f5;">
              <p style="color: #d63031; margin: 0; font-weight: bold;">QR CODE NOT AVAILABLE</p>
              <p style="color: #d63031; margin: 5px 0 0 0; font-size: 12px;">Please contact the event organizer</p>
            </div>
          `;
          // console.error("❌ No QR code URL available for email");
        }

        // Convert SVG to PNG for email compatibility using pngConvertLambda
        let pngQrCodeUrl = "";
        if (qrCodeUrl) {
          try {
            const lambdaResponse = await invokeLambda(process.env.PNG_CONVERT_LAMBDA!, {
              guestId: guest._id.toString(),
              eventId: eventId || guest.eventId
            });
            
            const parsedBody = typeof lambdaResponse.body === 'string' 
              ? JSON.parse(lambdaResponse.body) 
              : lambdaResponse.body;
            
            pngQrCodeUrl = parsedBody?.pngUrl || "";
          } catch (pngError) {
            console.error("❌ PNG conversion failed:", pngError);
          }
        }
        
        const finalQrUrl = pngQrCodeUrl || qrCodeUrl;
        const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id.toString()}`;

        // Get QR center color for header and determine text color
        const centerColorHex = rgbToHex(guest.qrCodeCenterColor || "0,0,0");
        const darkerCenterColor = adjustColorBrightness(centerColorHex, -20);
        
        // Simple text color logic: white for dark colors, black for light colors
        const num = parseInt(centerColorHex.replace("#", ""), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 180 ? "#000000" : "#ffffff";
        
        // Create beautiful, mature invitation email design
        const emailContent = `
          <div style="font-family: 'Segoe UI', 'Arial', sans-serif; background: #f7f8fc; padding: 20px 10px; margin: 0; line-height: 1.6;">
            <div style="width: 100%; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
              
              <!-- Header Section -->
              <div style="background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); padding: 40px 20px; text-align: center;">
                <h1 style="color: ${textColor}; font-size: clamp(24px, 5vw, 32px); font-weight: 600; margin: 0 0 8px 0; letter-spacing: 0.5px;">${eventName}</h1>
                <p style="color: ${textColor}; font-size: clamp(14px, 3vw, 18px); margin: 0; opacity: 0.9;">${eventDate}</p>
              </div>

              <!-- Main Content -->
              <div style="padding: 30px 20px;">
                
                <!-- Personal Greeting -->
                <div style="margin-bottom: 30px;">
                  <div style="background: #f8faff; padding: 20px; border-radius: 8px;">
                    <p style="font-size: clamp(16px, 4vw, 18px); margin: 0 0 12px 0; font-weight: 600; color: ${darkerCenterColor};">Dear ${guest.fullname},</p>
                    <div style="font-size: clamp(14px, 3.5vw, 16px); color: #4a5568; line-height: 1.7;">
                      ${sanitizedMessage}
                    </div>
                  </div>
                </div>

                <!-- QR Code Section -->
                <div style="text-align: center; background: linear-gradient(135deg, #f8faff 0%, #e8f2ff 100%); padding: 30px 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
                  <h2 style="color: ${centerColorHex}; font-size: clamp(18px, 4vw, 22px); font-weight: 600; margin: 0 0 25px 0;">🎟️ Your Digital Pass</h2>
                  
                  <div style="background: #ffffff; padding: clamp(30px, 6vw, 50px); border-radius: 12px; display: inline-block; box-shadow: 0 4px 16px rgba(30,60,114,0.1); border: 1px solid #e2e8f0;">
                    ${finalQrUrl ? `
                      <a href="${downloadUrl}">
                        <img src="${finalQrUrl}" 
                             alt="Your Event QR Code" 
                             width="300" height="300"
                             style="display: block; border-radius: 8px; max-width: 100%; height: auto; cursor: pointer;" />
                      </a>
                    ` : `
                      <div style="width: 300px; height: 300px; background: #f7f8fc; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 2px dashed #cbd5e0; max-width: 100%;">
                        <p style="color: #718096; margin: 0; font-size: 14px; text-align: center;">Loading QR Code...</p>
                      </div>
                    `}
                  </div>
                  
                  <p style="color: #718096; font-size: clamp(12px, 3vw, 14px); margin: 20px 0 25px 0;">Present this code at the event entrance for quick check-in</p>
                  
                  <a href="${downloadUrl}" 
                     style="display: inline-block; background: linear-gradient(135deg, ${centerColorHex} 0%, ${darkerCenterColor} 100%); color: ${textColor}; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: clamp(12px, 3vw, 14px); box-shadow: 0 4px 12px rgba(30,60,114,0.3); transition: all 0.3s ease;">
                     Download QR Code
                  </a>
                </div>

                <!-- Important Notice -->
                <div style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: #ffffff; padding: 20px; border-radius: 10px; margin: 30px 0 0 0; text-align: center;">
                  <p style="font-size: 15px; font-weight: 600; margin: 0 0 5px 0;">Invitation Confirmed</p>
                  <p style="font-size: 13px; margin: 0; opacity: 0.9;">This invitation is exclusively for you. Please keep your QR code secure.</p>
                </div>
              </div>

              <!-- Footer -->
              <div style="background: #f7f8fc; padding: 25px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="font-size: 12px; color: #718096; margin: 0;">© 2025 <strong style="color: #4a5568;">SoftInvites</strong> • All rights reserved</p>
              </div>
            </div>
          </div>
        `;

        // console.log("📤 Sending email to:", guest.email);
        
        // Prepare attachments array
        const attachments = [];
        
        // Add event IV as attachment if it exists
        if (iv) {
          try {
            // Download the image from URL to get Buffer
            const imageResponse = await fetch(iv);
            if (imageResponse.ok) {
              const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
              attachments.push({
                filename: `${eventName.replace(/[^a-zA-Z0-9]/g, '_')}_invitation.jpg`,
                content: imageBuffer,
                contentType: 'image/jpeg'
              });
            }
          } catch (attachmentError) {
            console.error("❌ Failed to download event IV for attachment:", attachmentError);
          }
        }
        
        // Send email with event IV attachment
        await sendEmail(
          guest.email, 
          `Invitation to ${eventName}`,
          emailContent,
          `${eventName} <info@softinvite.com>`,
          attachments.length > 0 ? attachments : undefined
        );

        emailSent = true;
        // console.log(`✅ Email sent to ${guest.email}`);

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

    res.status(200).json({
      message: qrCodeRegenerated 
        ? "Guest updated successfully and QR code regenerated" 
        : "Guest updated successfully",
      guest,
      emailSent: emailSent,
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

// New endpoint for QR scanner with timestamp
export const checkInGuest = async (req: Request, res: Response): Promise<void> => {
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
        status: guest.status
      }
    });
  } catch (error) {
    console.error("❌ Error in checkInGuest:", error);
    res.status(500).json({
      message: "Error checking in guest",
      error: error instanceof Error ? error.message : error,
    });
  }
};

export const downloadQRCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const guest = await Guest.findById(id);
    
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    try {
      const lambdaResponse = await invokeLambda(process.env.PNG_CONVERT_LAMBDA!, {
        guestId: guest._id.toString(),
        eventId: guest.eventId.toString()
      });
      
      const parsedBody = typeof lambdaResponse.body === 'string' 
        ? JSON.parse(lambdaResponse.body) 
        : lambdaResponse.body;
      
      const pngUrl = parsedBody?.pngUrl;
      
      if (pngUrl) {
        res.setHeader('Content-Disposition', `attachment; filename="qr-${guest.fullname || 'guest'}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.redirect(pngUrl);
        return;
      }
    } catch (pngError) {
      console.error("❌ PNG conversion failed:", pngError);
    }

    if (guest.qrCode) {
      res.redirect(guest.qrCode);
      return;
    }

    res.status(404).json({ message: "QR code not available" });
  } catch (error) {
    console.error("❌ Error in downloadQRCode:", error);
    res.status(500).json({ 
      message: "Error downloading QR code",
      error: error instanceof Error ? error.message : 'Unknown error'
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
    const guest = await Guest.findById(id);
    
    if (!guest) {
      res.status(404).json({ message: "Guest not found" });
      return;
    }

    try {
      const lambdaResponse = await invokeLambda(process.env.PNG_CONVERT_LAMBDA!, {
        guestId: guest._id.toString(),
        eventId: guest.eventId.toString()
      });
      
      const parsedBody = typeof lambdaResponse.body === 'string' 
        ? JSON.parse(lambdaResponse.body) 
        : lambdaResponse.body;
      
      const pngUrl = parsedBody?.pngUrl;
      
      if (pngUrl) {
        res.setHeader('Content-Disposition', `attachment; filename="qr-${guest.fullname || 'guest'}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.redirect(pngUrl);
        return;
      }
    } catch (pngError) {
      console.error("❌ PNG conversion failed:", pngError);
    }

    if (guest.qrCode) {
      res.redirect(guest.qrCode);
      return;
    }

    res.status(404).json({ message: "QR code not available" });
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

    await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.BACKUP_LAMBDA!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({}))
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
      res.status(400).json({ message: "start and end query params are required" });
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

    await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.BACKUP_LAMBDA!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({}))
    }));
    
    res.status(200).json({
      message: `Deleted ${deleteResult.deletedCount} guests for event ${eventId}`
    });
  } catch (error) {
    console.error("Error deleting guests by event + timestamp:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteSelectedGuests = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { guestIds } = req.body;

    if (!guestIds || !Array.isArray(guestIds) || guestIds.length === 0) {
      res.status(400).json({ message: "Guest IDs array is required" });
      return;
    }

    const guests = await Guest.find({ _id: { $in: guestIds } });
    
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
    
    const deleteResult = await Guest.deleteMany({ _id: { $in: guestIds } });

    await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.BACKUP_LAMBDA!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({}))
    }));

    res.status(200).json({
      message: `Successfully deleted ${deleteResult.deletedCount} guests`,
      deletedCount: deleteResult.deletedCount
    });
  } catch (error) {
    console.error("Error deleting selected guests:", error);
    res.status(500).json({ message: "Error deleting selected guests" });
  }
};

export const scanQRCode = async (
  req: Request,
  res: Response
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

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decodedToken = jwt.verify(token, process.env.JWT_SECRET as string) as any;
        const authorizedEventId = decodedToken.eventId;
        
        if (authorizedEventId && guest.eventId.toString() !== authorizedEventId) {
          res.status(403).json({ 
            message: "This guest belongs to a different event",
            guestEvent: guest.eventId.toString(),
            scannerEvent: authorizedEventId
          });
          return;
        }
      } catch (tokenError) {
        console.warn("Invalid token provided, continuing without event validation:", tokenError);
      }
    }

    const currentStatus = event.getEventStatus();
    if (currentStatus === "expired") {
      res.status(410).json({ 
        message: "Event has expired. Check-in is no longer available.",
        eventDate: event.date,
        eventStatus: "expired"
      });
      return;
    }

    if (!event.isActive) {
      res.status(403).json({ 
        message: "Event is not active",
        eventStatus: "inactive"
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
          checkedInAt: guest.checkedInAt || guest.updatedAt
        }
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
        status: guest.status
      },
      event: {
        name: event.name,
        date: event.date,
        location: event.location
      },
      success: true
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
    const totalEvents = await Event.countDocuments();
    const totalGuests = await Guest.countDocuments();
    const checkedInGuests = await Guest.countDocuments({ checkedIn: true });
    const unusedCodes = totalGuests - checkedInGuests;

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
  res: Response
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
      { expiresIn: "72h" }
    );

    const tempLink = `${process.env.FRONTEND_URL}/guest?token=${token}`;
    res.status(200).json({ tempLink });
  } catch (error) {
    console.error("Error generating temp link:", error);
    res.status(500).json({ message: "Error generating temp link" });
  }
};


export const restoreGuestsAndRegenerateQRCodes = async (req: Request, res: Response) => {
  try {
    const { key, eventId } = req.body;

    if (!key || !eventId) {
      return res.status(400).json({
        message: "Both 'key' (S3 path) and 'eventId' are required.",
      });
    }

    console.time('CompleteRestoreProcess');

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
    const eventGuests = allGuests.filter(g => g.eventId === eventId);

    if (eventGuests.length === 0) {
      return res.status(404).json({
        message: `No guests found for event: ${eventId}`,
      });
    }

    const existingGuests = await Guest.find({ eventId: new Types.ObjectId(eventId) }).lean();
    const existingIds = new Set(existingGuests.map(g => String(g._id)));

    const guestsToInsert = eventGuests
      .map(guest => {
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
          updatedAt: guest.updatedAt ? new Date(guest.updatedAt) : new Date()
        };
        
        delete newGuest.__v;
        return newGuest;
      })
      .filter(guest => guest !== null);

    if (guestsToInsert.length === 0) {
      const existingGuestsForQR = await Guest.find({ eventId: new Types.ObjectId(eventId) });
      const qrResults = await regenerateQRCodes(existingGuestsForQR);
      
      console.timeEnd('CompleteRestoreProcess');
      
      return res.status(200).json({
        message: `All ${eventGuests.length} guests for event ${eventId} already exist. QR codes regenerated for existing guests.`,
        restoredCount: 0,
        eventId,
        totalFound: eventGuests.length
      });
    }

    let insertedGuests = [];
    try {
      insertedGuests = await Guest.insertMany(guestsToInsert, { ordered: false });
    } catch (insertError: any) {
      console.error('❌ Database insert failed:', insertError);
      throw insertError;
    }

    const allGuestsForQR = await Guest.find({ eventId: new Types.ObjectId(eventId) });
    const qrResults = await regenerateQRCodes(allGuestsForQR);

    console.timeEnd('CompleteRestoreProcess');

    res.status(200).json({
      message: `✅ Complete restore process finished for event ${eventId}`,
      restoredCount: insertedGuests.length,
      qrRegeneration: qrResults,
      eventId,
      totalGuestsInEvent: allGuestsForQR.length
    });

  } catch (error: any) {
    console.timeEnd('CompleteRestoreProcess');
    console.error("❌ Error in complete restore process:", error);
    res.status(500).json({
      message: "Internal server error during complete restore process.",
      error: error.message
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

      const lambdaResponse = await invokeLambda(process.env.QR_LAMBDA_FUNCTION_NAME!, lambdaPayload);
      
      let parsedBody;
      if (lambdaResponse.body) {
        parsedBody = typeof lambdaResponse.body === 'string' 
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
            updatedAt: new Date()
          }
        }
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
    totalProcessed: guests.length
  };
};

const streamToString = (stream: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
};

export const testDatabase = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    
    const existingGuests = await Guest.find({ eventId: new Types.ObjectId(eventId) }).lean();
    
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
      qrCodeEdgeColor: "0,0,0"
    };
    
    const testGuest = await Guest.create(testGuestData);
    const verifiedGuest = await Guest.findById(testGuest._id);
    
    res.status(200).json({
      message: "Database test successful",
      readCount: existingGuests.length,
      writeVerified: !!verifiedGuest,
      testGuestId: testGuest._id
    });
    
  } catch (error: any) {
    console.error("❌ Database test failed:", error);
    res.status(500).json({
      message: "Database test failed",
      error: error.message
    });
  }
};

export const checkQRCodeStatus = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    
    const guests = await Guest.find({ eventId: new Types.ObjectId(eventId) })
      .select('fullname qrCode qrCodeData')
      .lean();
    
    const results = [];
    
    for (const guest of guests) {
      let status = 'unknown';
      let accessible = false;
      
      if (guest.qrCode) {
        try {
          const response = await fetch(guest.qrCode, { method: 'HEAD' });
          accessible = response.ok;
          status = accessible ? 'accessible' : 'inaccessible';
        } catch (error) {
          status = 'error';
          accessible = false;
        }
      } else {
        status = 'missing';
        accessible = false;
      }
      
      results.push({
        guestId: guest._id.toString(),
        fullname: guest.fullname,
        qrCode: guest.qrCode,
        status,
        accessible
      });
    }

    const accessibleCount = results.filter(r => r.accessible).length;
    const inaccessibleCount = results.filter(r => !r.accessible).length;
    
    res.status(200).json({
      message: `QR Code Status for event ${eventId}`,
      totalGuests: guests.length,
      accessible: accessibleCount,
      inaccessible: inaccessibleCount,
      results: results.slice(0, 10)
    });

  } catch (error: any) {
    console.error("❌ Error checking QR codes:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message
    });
  }
};