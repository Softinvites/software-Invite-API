"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkQRCodeStatus = exports.testDatabase = exports.restoreGuestsAndRegenerateQRCodes = exports.generateTempLink = exports.generateEventAnalytics = exports.generateAnalytics = exports.scanQRCode = exports.deleteGuestsByEventAndTimestamp = exports.deleteGuestsByEvent = exports.deleteGuestById = exports.getGuestById = exports.getGuestsByEvent = exports.downloadEmailQRCode = exports.downloadBatchQRCodes = exports.downloadAllQRCodes = exports.downloadQRCode = exports.updateGuest = exports.importGuests = exports.addGuest = void 0;
const guestmodel_1 = require("../models/guestmodel");
const eventmodel_1 = require("../models/eventmodel");
const qrcode_svg_1 = __importDefault(require("qrcode-svg"));
const lambdaUtils_1 = require("../utils/lambdaUtils");
const s3Utils_1 = require("../utils/s3Utils");
const utils_1 = require("../utils/utils");
const emailService_1 = require("../library/helpers/emailService");
const colorUtils_1 = require("../utils/colorUtils");
const sharp_1 = __importDefault(require("sharp"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const mongoose_1 = __importStar(require("mongoose"));
const sanitize_html_1 = __importDefault(require("sanitize-html"));
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_s3_1 = require("@aws-sdk/client-s3");
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION });
const addGuest = async (req, res) => {
    try {
        const { fullname, TableNo, email, phone, message, others, eventId, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor, } = req.body;
        // --- Validate Input ---
        const validateGuest = utils_1.createGuestSchema.validate(req.body, utils_1.option);
        if (validateGuest.error) {
            res.status(400).json({ error: validateGuest.error.details[0].message });
            return;
        }
        // --- Check Event Existence ---
        const event = await eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const eventName = event.name;
        const iv = event.iv;
        // --- Create Guest (no QR yet) ---
        const newGuest = new guestmodel_1.Guest({
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
        let qrSvg, qrCodeUrl;
        try {
            const lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.QR_LAMBDA_FUNCTION_NAME, lambdaPayload);
            console.log("✅ Lambda Response Received:", JSON.stringify(lambdaResponse, null, 2));
            // Parse the nested response structure
            let parsedBody;
            if (lambdaResponse.body) {
                if (typeof lambdaResponse.body === 'string') {
                    try {
                        parsedBody = JSON.parse(lambdaResponse.body);
                    }
                    catch (parseError) {
                        console.error("❌ Failed to parse Lambda response body:", parseError);
                        parsedBody = {};
                    }
                }
                else {
                    parsedBody = lambdaResponse.body;
                }
            }
            else {
                parsedBody = lambdaResponse;
            }
            console.log("🔍 Parsed Lambda Body:", parsedBody);
            // Extract QR data from parsed body
            qrSvg = parsedBody?.qrSvg;
            qrCodeUrl = parsedBody?.qrCodeUrl;
            console.log("🎯 Extracted QR Data:", {
                hasSvg: !!qrSvg,
                svgLength: qrSvg?.length,
                hasUrl: !!qrCodeUrl,
                url: qrCodeUrl
            });
        }
        catch (lambdaError) {
            console.error("❌ Lambda invocation failed:", lambdaError);
            qrSvg = "";
            qrCodeUrl = "";
        }
        // Continue with your existing logic...
        console.log("🔍 QR Code Analysis:", {
            hasSvg: !!qrSvg,
            svgType: typeof qrSvg,
            svgLength: qrSvg?.length,
            svgPreview: qrSvg ? qrSvg.substring(0, 100) + '...' : undefined,
            hasUrl: !!qrCodeUrl,
            url: qrCodeUrl
        });
        // Update guest with QR data
        savedGuest.qrCode = qrCodeUrl || qrSvg || "";
        await savedGuest.save();
        console.log("💾 QR data saved to database");
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
                const sanitizedMessage = (0, sanitize_html_1.default)(message, {
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
                }
                else {
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
                await (0, emailService_1.sendEmail)(email, `${eventName} - Invitation`, emailContent);
                console.log(`✅ Email sent to ${email}`);
            }
            catch (emailError) {
                console.error("❌ Failed to send email:", emailError);
            }
        }
        // --- Trigger Backup Lambda (async) ---
        try {
            await lambdaClient.send(new client_lambda_1.InvokeCommand({
                FunctionName: process.env.BACKUP_LAMBDA,
                InvocationType: "Event",
                Payload: Buffer.from(JSON.stringify({})),
            }));
        }
        catch (backupError) {
            console.error("❌ Backup Lambda failed:", backupError);
        }
        res.status(201).json({
            message: "Guest created successfully",
            guest: savedGuest,
        });
    }
    catch (error) {
        console.error("Error in addGuest:", error);
        res.status(500).json({
            message: "Error creating guest",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.addGuest = addGuest;
const importGuests = async (req, res) => {
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
        const fileUrl = await (0, s3Utils_1.uploadToS3)(req.file.buffer, fileKey, req.file.mimetype);
        console.log("📤 Uploaded file to S3:", fileKey);
        console.log("🔗 File URL:", fileUrl);
        // Wait 3 seconds for S3 consistency AND to ensure file is fully uploaded
        console.log("⏳ Waiting for S3 consistency and file availability...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Trigger import Lambda asynchronously
        await (0, lambdaUtils_1.invokeLambda)(process.env.IMPORT_LAMBDA_FUNCTION_NAME, {
            fileUrl,
            eventId,
            userEmail
        }, true);
        res.status(202).json({
            message: "Import job is running. You will receive an email when processing completes.",
            fileUrl
        });
    }
    catch (error) {
        console.error("Error starting import job:", error);
        res.status(500).json({
            message: "Error starting import job",
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
};
exports.importGuests = importGuests;
const updateGuest = async (req, res) => {
    try {
        // Handle both JSON string and already-parsed object
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        const { id, fullname, TableNo, email, phone, message, others, eventId, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor, } = body;
        if (!id) {
            res.status(400).json({ message: "Guest ID is required" });
            return;
        }
        const validateGuest = utils_1.updateGuestSchema.validate(body, utils_1.option);
        if (validateGuest.error) {
            res.status(400).json({ Error: validateGuest.error.details[0].message });
            return;
        }
        const guest = await guestmodel_1.Guest.findById(id);
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
        const event = await eventmodel_1.Event.findById(eventId || guest.eventId);
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
        const qrColorsChanged = ((qrCodeBgColor !== undefined && qrCodeBgColor !== guest.qrCodeBgColor) ||
            (qrCodeCenterColor !== undefined && qrCodeCenterColor !== guest.qrCodeCenterColor) ||
            (qrCodeEdgeColor !== undefined && qrCodeEdgeColor !== guest.qrCodeEdgeColor));
        // Update guest fields only if provided (proper optional field handling)
        if (fullname !== undefined)
            guest.fullname = fullname;
        if (TableNo !== undefined)
            guest.TableNo = TableNo;
        if (email !== undefined)
            guest.email = email;
        if (phone !== undefined)
            guest.phone = phone;
        if (message !== undefined) {
            guest.message = (0, sanitize_html_1.default)(message, {
                allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br", "h1", "h2"],
                allowedAttributes: {},
            });
        }
        if (others !== undefined)
            guest.others = others;
        let qrCodeUrl = guest.qrCode;
        let qrCodeRegenerated = false;
        // --- REGENERATE QR CODE IF MISSING ---
        if (!guest.qrCode) {
            console.log("🔄 QR code missing in database, generating now...");
            // Set colors if provided, otherwise use existing or defaults
            if (qrCodeBgColor !== undefined)
                guest.qrCodeBgColor = qrCodeBgColor;
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
            console.log("📤 Generating missing QR code:", lambdaPayload);
            let qrSvg, lambdaResponse;
            try {
                lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.QR_LAMBDA_FUNCTION_NAME, lambdaPayload);
                console.log("✅ Lambda Response for missing QR:", JSON.stringify(lambdaResponse, null, 2));
                // Parse the nested response structure (same as addGuest)
                let parsedBody;
                if (lambdaResponse.body) {
                    if (typeof lambdaResponse.body === 'string') {
                        try {
                            parsedBody = JSON.parse(lambdaResponse.body);
                        }
                        catch (parseError) {
                            console.error("❌ Failed to parse Lambda response body:", parseError);
                            parsedBody = {};
                        }
                    }
                    else {
                        parsedBody = lambdaResponse.body;
                    }
                }
                else {
                    parsedBody = lambdaResponse;
                }
                console.log("🔍 Parsed Lambda Body:", parsedBody);
                // Extract QR data from parsed body (same as addGuest)
                qrSvg = parsedBody?.qrSvg;
                qrCodeUrl = parsedBody?.qrCodeUrl;
                console.log("🎯 Extracted QR Data:", {
                    hasSvg: !!qrSvg,
                    svgLength: qrSvg?.length,
                    hasUrl: !!qrCodeUrl,
                    url: qrCodeUrl
                });
                if (qrCodeUrl) {
                    guest.qrCode = qrCodeUrl;
                    guest.qrCodeData = guest._id.toString();
                    qrCodeRegenerated = true;
                    console.log("💾 Saved regenerated QR code to guest");
                }
                else {
                    console.error("❌ QR code generation failed - no URL returned");
                }
            }
            catch (lambdaError) {
                console.error("❌ Lambda invocation failed for missing QR:", lambdaError);
            }
        }
        // Update QR colors only if changed and provided
        else if (qrColorsChanged) {
            if (qrCodeBgColor !== undefined)
                guest.qrCodeBgColor = qrCodeBgColor;
            if (qrCodeCenterColor !== undefined)
                guest.qrCodeCenterColor = qrCodeCenterColor;
            if (qrCodeEdgeColor !== undefined)
                guest.qrCodeEdgeColor = qrCodeEdgeColor;
            console.log("🎨 QR colors updated but QR code NOT regenerated (same guest ID)");
        }
        await guest.save();
        console.log("💾 Guest data saved to database");
        // Use QR code URL (either existing or newly generated)
        qrCodeUrl = guest.qrCode;
        console.log("📄 Final QR code URL:", qrCodeUrl);
        // --- Email Sending (ONLY if email is updated) ---
        let emailSent = false;
        if (emailChanged && guest.email) {
            try {
                const sanitizedMessage = (0, sanitize_html_1.default)(guest.message, {
                    allowedTags: ["p", "b", "i", "strong", "em", "ul", "li", "br", "h1", "h2"],
                    allowedAttributes: {},
                });
                console.log("📧 Email QR Status:", {
                    hasS3Url: !!qrCodeUrl,
                    s3Url: qrCodeUrl
                });
                let qrImgTag;
                // Use S3 URL directly in email (EXACT same as addGuest)
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
                }
                else {
                    qrImgTag = `
            <div style="border: 2px solid #ff6b6b; padding: 15px; margin: 10px 0; text-align: center; background: #fff5f5;">
              <p style="color: #d63031; margin: 0; font-weight: bold;">QR CODE NOT AVAILABLE</p>
              <p style="color: #d63031; margin: 5px 0 0 0; font-size: 12px;">Please contact the event organizer</p>
            </div>
          `;
                    console.error("❌ No QR code URL available for email");
                }
                // EXACT same email template as addGuest
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
                // Send email WITHOUT attachments - QR code is embedded via S3 URL (same as addGuest)
                await (0, emailService_1.sendEmail)(guest.email, `${eventName} - Invitation`, emailContent);
                emailSent = true;
                console.log(`✅ Email sent to ${guest.email}`);
            }
            catch (emailError) {
                console.error("❌ Failed to send email:", emailError);
            }
        }
        // --- Trigger Backup Lambda (async) ---
        try {
            await lambdaClient.send(new client_lambda_1.InvokeCommand({
                FunctionName: process.env.BACKUP_LAMBDA,
                InvocationType: "Event",
                Payload: Buffer.from(JSON.stringify({})),
            }));
        }
        catch (backupError) {
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
    }
    catch (error) {
        console.error("❌ Error in updateGuest:", error);
        res.status(500).json({
            message: "Error updating guest",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.updateGuest = updateGuest;
const downloadQRCode = async (req, res) => {
    try {
        const { id } = req.params;
        const guest = await guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        const bgColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeBgColor);
        const centerColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeCenterColor);
        const edgeColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeEdgeColor);
        const qr = new qrcode_svg_1.default({
            content: guest._id.toString(),
            padding: 5,
            width: 512,
            height: 512,
            color: edgeColorHex,
            background: bgColorHex,
            xmlDeclaration: false,
        });
        let svg = qr.svg();
        svg = svg.replace(/<svg([^>]*)>/, `<svg$1>
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
          </radialGradient>
        </defs>`);
        svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
            const isBoundingRect = /x="0".*y="0"/.test(group1);
            return isBoundingRect
                ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
                : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        });
        const pngBuffer = await (0, sharp_1.default)(Buffer.from(svg))
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
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error downloading QR code" });
    }
};
exports.downloadQRCode = downloadQRCode;
const downloadAllQRCodes = async (req, res) => {
    try {
        const { eventId } = req.params;
        const guests = await guestmodel_1.Guest.find({ eventId });
        if (!guests.length) {
            res.status(404).json({ message: "No guests found" });
            return;
        }
        const qrItems = guests
            .map((guest) => {
            try {
                if (!guest.qrCode || typeof guest.qrCode !== "string")
                    return null;
                const url = new URL(guest.qrCode);
                const path = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
                if (!path.endsWith(".svg"))
                    return null;
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
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        if (!qrItems.length) {
            res.status(400).json({ message: "No valid QR code paths found" });
            return;
        }
        const lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.ZIP_LAMBDA_FUNCTION_NAME, {
            qrItems,
            eventId,
        });
        const statusCode = lambdaResponse?.statusCode || 500;
        let parsedBody = {};
        try {
            parsedBody = lambdaResponse?.body ? JSON.parse(lambdaResponse.body) : {};
        }
        catch {
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
    }
    catch (error) {
        console.error("Error in downloadAllQRCodes:", error);
        res.status(500).json({
            message: "Internal server error",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.downloadAllQRCodes = downloadAllQRCodes;
const downloadBatchQRCodes = async (req, res) => {
    try {
        const { eventId } = req.params;
        const { start, end } = req.body;
        const startDate = start ? new Date(start) : new Date(0);
        const endDate = end ? new Date(end) : new Date();
        const guests = await guestmodel_1.Guest.find({
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
                if (!guest.qrCode || typeof guest.qrCode !== "string")
                    return null;
                const url = new URL(guest.qrCode);
                const path = url.pathname.startsWith("/")
                    ? url.pathname.slice(1)
                    : url.pathname;
                if (!path.endsWith(".svg"))
                    return null;
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
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        if (!qrItems.length) {
            res.status(400).json({ message: "No valid QR code paths found in the given range" });
            return;
        }
        const lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.ZIP_LAMBDA_FUNCTION_NAME, {
            qrItems,
            eventId,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
        });
        const statusCode = lambdaResponse?.statusCode || 500;
        let parsedBody = {};
        try {
            parsedBody = lambdaResponse?.body ? JSON.parse(lambdaResponse.body) : {};
        }
        catch {
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
    }
    catch (error) {
        console.error("Error in downloadBatchQRCodes:", error);
        res.status(500).json({
            message: "Internal server error while creating batch QR ZIP",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.downloadBatchQRCodes = downloadBatchQRCodes;
const downloadEmailQRCode = async (req, res) => {
    try {
        const { id } = req.params;
        console.log("📥 Download request for guest ID:", id);
        const guest = await guestmodel_1.Guest.findById(id);
        if (!guest) {
            console.log("❌ Guest not found:", id);
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        console.log("✅ Guest found:", guest.fullname);
        const bgColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeBgColor);
        const centerColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeCenterColor);
        const edgeColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeEdgeColor);
        console.log("🎨 Colors:", { bgColorHex, centerColorHex, edgeColorHex });
        // Generate QR code
        const qr = new qrcode_svg_1.default({
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
        svg = svg.replace(/<svg([^>]*)>/, `<svg$1>
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
          </radialGradient>
        </defs>`);
        svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
            const isBoundingRect = /x="0".*y="0"/.test(group1);
            return isBoundingRect
                ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
                : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        });
        console.log("🔄 Converting SVG to PNG...");
        // Fix for Sharp conversion - ensure proper SVG input
        try {
            // Clean the SVG and ensure it's valid
            const cleanSvg = svg.trim();
            // Convert SVG to PNG with proper error handling
            const pngBuffer = await (0, sharp_1.default)(Buffer.from(cleanSvg), {
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
        }
        catch (sharpError) {
            console.error("❌ Sharp conversion error:", sharpError);
            // Fallback: Return the SVG directly
            console.log("🔄 Falling back to SVG format");
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Content-Disposition', `attachment; filename="qr-${guest.fullname}.svg"`);
            res.send(svg);
        }
    }
    catch (error) {
        console.error("❌ Error in downloadEmailQRCode:", error);
        res.status(500).json({
            message: "Error downloading QR code",
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};
exports.downloadEmailQRCode = downloadEmailQRCode;
const getGuestsByEvent = async (req, res) => {
    try {
        const { eventId } = req.params;
        const guests = await guestmodel_1.Guest.find({ eventId: eventId });
        if (guests.length == 0) {
            res.status(400).json({ message: "No events found" });
            return;
        }
        res.status(200).json({
            message: "Successfully fetched all guests for the events",
            guests,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching guests" });
    }
};
exports.getGuestsByEvent = getGuestsByEvent;
const getGuestById = async (req, res) => {
    try {
        const { id } = req.params;
        const guest = await guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
        }
        res.status(200).json({ message: "Successfully fetched guest", guest });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching guest" });
    }
};
exports.getGuestById = getGuestById;
const deleteGuestById = async (req, res) => {
    try {
        const { id } = req.params;
        const guest = await guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Delete from S3
        if (guest.qrCode) {
            const url = new URL(guest.qrCode);
            const key = url.pathname.substring(1);
            await (0, s3Utils_1.deleteFromS3)(key);
        }
        await guestmodel_1.Guest.findByIdAndDelete(id);
        res.status(200).json({ message: "Guest deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting guest:", error);
        res.status(500).json({ message: "Error deleting guest" });
    }
};
exports.deleteGuestById = deleteGuestById;
const deleteGuestsByEvent = async (req, res) => {
    try {
        const { eventId } = req.params;
        const guests = await guestmodel_1.Guest.find({ eventId });
        if (!guests.length) {
            res.status(404).json({ message: "No guests found for this event" });
            return;
        }
        // Delete QR codes from S3
        const deletionPromises = guests.map(async (guest) => {
            if (guest.qrCode) {
                try {
                    const key = new URL(guest.qrCode).pathname.slice(1);
                    await (0, s3Utils_1.deleteFromS3)(key);
                }
                catch (err) {
                    console.error(`Failed to delete QR for ${guest.fullname}:`, err);
                }
            }
        });
        await Promise.allSettled(deletionPromises);
        await guestmodel_1.Guest.deleteMany({ eventId });
        // After successful create/update/delete operations:
        await lambdaClient.send(new client_lambda_1.InvokeCommand({
            FunctionName: process.env.BACKUP_LAMBDA,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
        }));
        res.status(200).json({
            message: "All guests and their QR codes deleted successfully",
            deletedCount: guests.length
        });
    }
    catch (error) {
        console.error("Error deleting guests:", error);
        res.status(500).json({ message: "Error deleting guests" });
    }
};
exports.deleteGuestsByEvent = deleteGuestsByEvent;
const deleteGuestsByEventAndTimestamp = async (req, res) => {
    try {
        const { eventId } = req.params;
        const { start, end } = req.body;
        const startDate = new Date(start);
        const endDate = new Date(end);
        const guests = await guestmodel_1.Guest.find({
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
                    await (0, s3Utils_1.deleteFromS3)(key);
                }
                catch (err) {
                    console.error(`Error deleting QR for ${guest.fullname}:`, err);
                }
            }
        });
        await Promise.allSettled(deletionPromises);
        const deleteResult = await guestmodel_1.Guest.deleteMany({
            eventId,
            createdAt: { $gte: startDate, $lte: endDate }
        });
        // After successful create/update/delete operations:
        await lambdaClient.send(new client_lambda_1.InvokeCommand({
            FunctionName: process.env.BACKUP_LAMBDA,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({})) // can pass data if needed
        }));
        res.status(200).json({
            message: `Deleted ${deleteResult.deletedCount} guests for event ${eventId}`
        });
    }
    catch (error) {
        console.error("Error deleting guests by event + timestamp:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
exports.deleteGuestsByEventAndTimestamp = deleteGuestsByEventAndTimestamp;
const scanQRCode = async (req, res) => {
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
        const guest = await guestmodel_1.Guest.findById(guestId);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Get the event details related to the guest's eventId
        const event = await eventmodel_1.Event.findById(guest.eventId);
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
    }
    catch (error) {
        console.error("🚨 Error during check-in:", error);
        res.status(500).json({ message: "Server error during check-in" });
    }
};
exports.scanQRCode = scanQRCode;
const generateAnalytics = async (req, res) => {
    try {
        // Basic counts
        const totalEvents = await eventmodel_1.Event.countDocuments();
        const totalGuests = await guestmodel_1.Guest.countDocuments();
        const checkedInGuests = await guestmodel_1.Guest.countDocuments({ checkedIn: true });
        const unusedCodes = totalGuests - checkedInGuests;
        // Guest status breakdown (pie chart data)
        const guestStatusBreakdownRaw = await guestmodel_1.Guest.aggregate([
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
        const checkInTrendRaw = await guestmodel_1.Guest.aggregate([
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
    }
    catch (error) {
        console.error("Error generating analytics:", error);
        res.status(500).json({ message: "Error generating analytics" });
    }
};
exports.generateAnalytics = generateAnalytics;
const generateEventAnalytics = async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!mongoose_1.default.Types.ObjectId.isValid(eventId)) {
            res.status(400).json({ message: "Invalid event ID format" });
            return;
        }
        // Get all guests using `eventId` (your schema design)
        const guests = await guestmodel_1.Guest.find({ eventId });
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
        const checkedInGuests = await guestmodel_1.Guest.countDocuments({
            eventId,
            checkedIn: true,
        });
        const unusedCodes = totalGuests - checkedInGuests;
        // Guest status breakdown
        const guestStatusBreakdownRaw = await guestmodel_1.Guest.aggregate([
            {
                $match: {
                    eventId: new mongoose_1.default.Types.ObjectId(eventId),
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
        const checkInTrendRaw = await guestmodel_1.Guest.aggregate([
            {
                $match: {
                    eventId: new mongoose_1.default.Types.ObjectId(eventId),
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
    }
    catch (error) {
        console.error("Error generating event analytics:", error);
        res.status(500).json({ message: "Error generating event analytics" });
    }
};
exports.generateEventAnalytics = generateEventAnalytics;
const generateTempLink = async (req, res) => {
    try {
        const { eventId } = req.params;
        // Check if the event exists
        const event = await eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        // Generate a JWT with event-specific data and expiration (e.g., 12 hours)
        const token = jsonwebtoken_1.default.sign({ eventId: eventId, role: "temp", type: "checkin" }, process.env.JWT_SECRET, { expiresIn: "72h" });
        // Create a temporary link with the token
        const tempLink = `${process.env.FRONTEND_URL}/guest?token=${token}`;
        res.status(200).json({ tempLink });
    }
    catch (error) {
        console.error("Error generating temp link:", error);
        res.status(500).json({ message: "Error generating temp link" });
    }
};
exports.generateTempLink = generateTempLink;
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION || "us-east-2" });
const restoreGuestsAndRegenerateQRCodes = async (req, res) => {
    try {
        const { key, eventId } = req.body;
        if (!key || !eventId) {
            return res.status(400).json({
                message: "Both 'key' (S3 path) and 'eventId' are required.",
            });
        }
        console.time('CompleteRestoreProcess');
        console.log(`🎯 Starting complete restore process for event: ${eventId}`);
        // Step 1: Download backup from S3
        console.log('📥 Downloading backup from S3...');
        const getObjectCommand = new client_s3_1.GetObjectCommand({
            Bucket: process.env.BACKUP_BUCKET || "softinvites-backups",
            Key: key,
        });
        const s3Response = await s3.send(getObjectCommand);
        if (!s3Response.Body) {
            return res.status(404).json({ message: "Backup file not found in S3." });
        }
        const jsonData = await streamToString(s3Response.Body);
        const allGuests = JSON.parse(jsonData);
        const eventGuests = allGuests.filter(g => g.eventId === eventId);
        console.log(`📋 Found ${eventGuests.length} guests for event ${eventId}`);
        if (eventGuests.length === 0) {
            return res.status(404).json({
                message: `No guests found for event: ${eventId}`,
            });
        }
        // Step 2: Check existing guests
        console.log('🔍 Checking existing guests...');
        const existingGuests = await guestmodel_1.Guest.find({ eventId: new mongoose_1.Types.ObjectId(eventId) }).lean();
        const existingIds = new Set(existingGuests.map(g => String(g._id)));
        console.log(`📋 Found ${existingIds.size} existing guests`);
        // Step 3: Prepare guests for insertion (preserve original _id, clear QR codes)
        const guestsToInsert = eventGuests
            .map(guest => {
            // Skip if guest already exists
            if (guest._id && existingIds.has(String(guest._id))) {
                console.log(`⏭️ Skipping existing guest: ${guest.fullname} (${guest._id})`);
                return null;
            }
            // 🎨 USE RGB FORMAT DIRECTLY (like your working functions)
            const qrCodeBgColor = guest.qrCodeBgColor || "255,255,255";
            const qrCodeCenterColor = guest.qrCodeCenterColor || "0,0,0";
            const qrCodeEdgeColor = guest.qrCodeEdgeColor || "125,14,43";
            console.log(`🎨 Using RGB colors for ${guest.fullname}:`, {
                bg: qrCodeBgColor,
                center: qrCodeCenterColor,
                edge: qrCodeEdgeColor
            });
            const newGuest = {
                // PRESERVE original _id
                _id: guest._id ? new mongoose_1.Types.ObjectId(guest._id) : new mongoose_1.Types.ObjectId(),
                // Copy all existing fields
                ...guest,
                // Ensure required fields exist
                fullname: guest.fullname || "Unknown Guest",
                eventId: new mongoose_1.Types.ObjectId(eventId),
                message: guest.message || "-",
                status: guest.status || "pending",
                checkedIn: guest.checkedIn || false,
                imported: guest.imported || true,
                // Optional fields with defaults
                TableNo: guest.TableNo || "-",
                email: guest.email || "",
                phone: guest.phone || "-",
                others: guest.others || "",
                // 🆕 CLEAR QR code fields - they'll be regenerated
                qrCode: "",
                qrCodeData: guest._id ? String(guest._id) : "",
                // 🎨 STORE COLORS IN RGB FORMAT (like your working functions)
                qrCodeBgColor: qrCodeBgColor,
                qrCodeCenterColor: qrCodeCenterColor,
                qrCodeEdgeColor: qrCodeEdgeColor,
                // 🕒 PRESERVE ORIGINAL TIMESTAMPS
                createdAt: guest.createdAt ? new Date(guest.createdAt) : new Date(),
                updatedAt: guest.updatedAt ? new Date(guest.updatedAt) : new Date()
            };
            // Remove MongoDB-specific fields (but keep timestamps!)
            delete newGuest.__v;
            console.log(`🕒 Preserved timestamps for ${guest.fullname}:`, {
                createdAt: newGuest.createdAt,
                updatedAt: newGuest.updatedAt
            });
            return newGuest;
        })
            .filter(guest => guest !== null);
        console.log(`🔄 Preparing to insert ${guestsToInsert.length} new guests`);
        if (guestsToInsert.length === 0) {
            console.log('ℹ️ No new guests to insert. Regenerating QR codes for existing guests...');
            // Even if no new guests, we can still regenerate QR codes for existing ones
            const existingGuestsForQR = await guestmodel_1.Guest.find({ eventId: new mongoose_1.Types.ObjectId(eventId) });
            const qrResults = await regenerateQRCodes(existingGuestsForQR);
            console.timeEnd('CompleteRestoreProcess');
            return res.status(200).json({
                message: `All ${eventGuests.length} guests for event ${eventId} already exist. QR codes regenerated for existing guests.`,
                restoredCount: 0,
                // qrRegeneration: qrResults,
                eventId,
                totalFound: eventGuests.length
            });
        }
        // Step 4: Insert guests into database
        let insertedGuests = [];
        try {
            insertedGuests = await guestmodel_1.Guest.insertMany(guestsToInsert, { ordered: false });
            console.log(`✅ Database insert successful: ${insertedGuests.length} guests`);
            // Verify timestamps were preserved
            if (insertedGuests.length > 0) {
                const sampleGuest = insertedGuests[0];
                console.log(`🕒 Sample guest timestamps after insert:`, {
                    name: sampleGuest.fullname,
                    createdAt: sampleGuest.createdAt,
                    updatedAt: sampleGuest.updatedAt
                });
            }
        }
        catch (insertError) {
            console.error('❌ Database insert failed:', insertError);
            if (insertError.writeErrors) {
                insertError.writeErrors.forEach((error, index) => {
                    console.error(`Error ${index + 1}:`, error.err.errmsg);
                });
            }
            throw insertError;
        }
        // Step 5: Regenerate QR codes for ALL guests (newly inserted + existing)
        console.log('🎨 Regenerating QR codes for all guests...');
        const allGuestsForQR = await guestmodel_1.Guest.find({ eventId: new mongoose_1.Types.ObjectId(eventId) });
        const qrResults = await regenerateQRCodes(allGuestsForQR);
        console.timeEnd('CompleteRestoreProcess');
        res.status(200).json({
            message: `✅ Complete restore process finished for event ${eventId}`,
            restoredCount: insertedGuests.length,
            qrRegeneration: qrResults,
            eventId,
            totalGuestsInEvent: allGuestsForQR.length,
            summary: {
                guestsRestored: insertedGuests.length,
                qrCodesGenerated: qrResults.regeneratedCount,
                qrCodesFailed: qrResults.failedCount,
                totalGuests: allGuestsForQR.length
            },
            // 🕒 Include timestamp info
            timestampInfo: {
                originalTimestampsPreserved: true,
                sampleTimestamps: insertedGuests.length > 0 ? {
                    createdAt: insertedGuests[0].createdAt,
                    updatedAt: insertedGuests[0].updatedAt
                } : null
            }
        });
    }
    catch (error) {
        console.timeEnd('CompleteRestoreProcess');
        console.error("❌ Error in complete restore process:", error);
        res.status(500).json({
            message: "Internal server error during complete restore process.",
            error: error.message
        });
    }
};
exports.restoreGuestsAndRegenerateQRCodes = restoreGuestsAndRegenerateQRCodes;
// Helper function to regenerate QR codes - USING RGB FORMAT LIKE YOUR WORKING FUNCTIONS
const regenerateQRCodes = async (guests) => {
    console.log(`🔄 Regenerating QR codes for ${guests.length} guests...`);
    let regeneratedCount = 0;
    let failedCount = 0;
    const results = [];
    for (const guest of guests) {
        try {
            console.log(`🔄 Processing guest: ${guest.fullname} (${guest._id})`);
            // 🎨 USE RGB FORMAT DIRECTLY (like your CSV import and addGuest functions)
            const lambdaPayload = {
                guestId: guest._id.toString(),
                fullname: guest.fullname,
                // Use RGB format directly (like your working functions)
                qrCodeBgColor: guest.qrCodeBgColor || "255,255,255",
                qrCodeCenterColor: guest.qrCodeCenterColor || "0,0,0",
                qrCodeEdgeColor: guest.qrCodeEdgeColor || "125,14,43",
                eventId: guest.eventId.toString(),
                TableNo: guest.TableNo || "-",
                others: guest.others || "",
            };
            console.log("🎨 Using RGB colors for Lambda:", {
                bg: lambdaPayload.qrCodeBgColor,
                center: lambdaPayload.qrCodeCenterColor,
                edge: lambdaPayload.qrCodeEdgeColor,
                guestId: guest._id.toString()
            });
            console.log("📤 Sending to QR Lambda:", lambdaPayload);
            const lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.QR_LAMBDA_FUNCTION_NAME, lambdaPayload);
            // Parse response (EXACTLY like your addGuest function)
            let parsedBody;
            if (lambdaResponse.body) {
                parsedBody = typeof lambdaResponse.body === 'string'
                    ? JSON.parse(lambdaResponse.body)
                    : lambdaResponse.body;
            }
            else {
                parsedBody = lambdaResponse;
            }
            console.log("🔍 Lambda Response:", JSON.stringify(parsedBody, null, 2));
            const qrCodeUrl = parsedBody?.qrCodeUrl;
            if (!qrCodeUrl) {
                throw new Error("No QR code URL returned from Lambda");
            }
            // Update guest with new QR code (preserve original colors and timestamps)
            // Use updateOne to avoid changing createdAt
            await guestmodel_1.Guest.updateOne({ _id: guest._id }, {
                $set: {
                    qrCode: qrCodeUrl,
                    qrCodeData: guest._id.toString(),
                    updatedAt: new Date() // Only update updatedAt
                }
            });
            regeneratedCount++;
            results.push({
                guestId: guest._id.toString(),
                fullname: guest.fullname,
                success: true,
                qrCodeUrl: qrCodeUrl,
                colors: {
                    background: lambdaPayload.qrCodeBgColor,
                    center: lambdaPayload.qrCodeCenterColor,
                    edge: lambdaPayload.qrCodeEdgeColor
                },
                // 🕒 Show timestamp info
                timestamps: {
                    originalCreatedAt: guest.createdAt,
                    newUpdatedAt: new Date()
                }
            });
            console.log(`✅ Regenerated QR for: ${guest.fullname}`);
        }
        catch (error) {
            failedCount++;
            results.push({
                guestId: guest._id.toString(),
                fullname: guest.fullname,
                success: false,
                error: error.message
            });
            console.error(`❌ Failed QR generation for ${guest.fullname}:`, error);
        }
    }
    return {
        regeneratedCount,
        failedCount,
        totalProcessed: guests.length,
        results: results.slice(0, 10)
    };
};
// Helper function to convert stream to string
const streamToString = (stream) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
};
const testDatabase = async (req, res) => {
    try {
        const { eventId } = req.params;
        console.log('🔍 Testing database for event:', eventId);
        // Test read first
        const existingGuests = await guestmodel_1.Guest.find({ eventId: new mongoose_1.Types.ObjectId(eventId) }).lean();
        console.log(`📊 Found ${existingGuests.length} guests for event ${eventId}`);
        // Test write with ALL required fields from your schema
        const testGuestData = {
            fullname: "Test Guest " + Date.now(),
            eventId: new mongoose_1.Types.ObjectId(eventId),
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
        console.log('🔄 Creating test guest...');
        const testGuest = await guestmodel_1.Guest.create(testGuestData);
        console.log('✅ Test guest created:', testGuest._id);
        // Verify write worked
        const verifiedGuest = await guestmodel_1.Guest.findById(testGuest._id);
        res.status(200).json({
            message: "Database test successful",
            readCount: existingGuests.length,
            writeVerified: !!verifiedGuest,
            testGuestId: testGuest._id
        });
    }
    catch (error) {
        console.error("❌ Database test failed:", error);
        res.status(500).json({
            message: "Database test failed",
            error: error.message
        });
    }
};
exports.testDatabase = testDatabase;
const checkQRCodeStatus = async (req, res) => {
    try {
        const { eventId } = req.params;
        const guests = await guestmodel_1.Guest.find({ eventId: new mongoose_1.Types.ObjectId(eventId) })
            .select('fullname qrCode qrCodeData')
            .lean();
        const results = [];
        for (const guest of guests) {
            let status = 'unknown';
            let accessible = false;
            if (guest.qrCode) {
                try {
                    // Test if QR code URL is accessible
                    const response = await fetch(guest.qrCode, { method: 'HEAD' });
                    accessible = response.ok;
                    status = accessible ? 'accessible' : 'inaccessible';
                }
                catch (error) {
                    status = 'error';
                    accessible = false;
                }
            }
            else {
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
            results: results.slice(0, 10) // Show first 10 for debugging
        });
    }
    catch (error) {
        console.error("❌ Error checking QR codes:", error);
        res.status(500).json({
            message: "Internal server error",
            error: error.message
        });
    }
};
exports.checkQRCodeStatus = checkQRCodeStatus;
