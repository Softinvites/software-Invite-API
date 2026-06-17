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
exports.resendAllEmails = exports.checkQRCodeStatus = exports.testDatabase = exports.restoreGuestsAndRegenerateQRCodes = exports.generateTempLink = exports.generateEventAnalytics = exports.generateAnalytics = exports.scanQRCode = exports.deleteSelectedGuests = exports.deleteGuestsByEventAndTimestamp = exports.deleteGuestsByEvent = exports.deleteGuestById = exports.getGuestById = exports.getGuestsByEvent = exports.downloadEmailQRCode = exports.downloadBatchQRCodes = exports.downloadAllQRCodes = exports.downloadQRCode = exports.checkInGuest = exports.importGuests = exports.updateGuest = exports.addGuest = void 0;
const guestmodel_1 = require("../models/guestmodel");
const eventmodel_1 = require("../models/eventmodel");
const lambdaUtils_1 = require("../utils/lambdaUtils");
const s3Utils_1 = require("../utils/s3Utils");
const utils_1 = require("../utils/utils");
const buildInvitationEmail_js_1 = require("../utils/buildInvitationEmail.js");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const mongoose_1 = __importStar(require("mongoose"));
const sanitize_html_1 = __importDefault(require("sanitize-html"));
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_s3_1 = require("@aws-sdk/client-s3");
const sharp_1 = __importDefault(require("sharp"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION || "us-east-2" });
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION });
const normalizeName = (value) => (value || "").trim().replace(/\s+/g, " ").toLowerCase();
const buildPngUrl = (eventId, guestId) => {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.AWS_REGION || "us-east-2";
    if (!bucket || !eventId || !guestId)
        return "";
    return `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/png/${eventId}/${guestId}.png`;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inferImageContentType = (url) => {
    const pathname = (() => {
        try {
            return new URL(url).pathname.toLowerCase();
        }
        catch {
            return String(url || "").toLowerCase();
        }
    })();
    if (pathname.endsWith(".png"))
        return "image/png";
    if (pathname.endsWith(".webp"))
        return "image/webp";
    if (pathname.endsWith(".gif"))
        return "image/gif";
    return "image/jpeg";
};
const resolveAttachmentExtension = (contentType) => {
    if (contentType === "image/png")
        return "png";
    if (contentType === "image/webp")
        return "webp";
    if (contentType === "image/gif")
        return "gif";
    return "jpg";
};
const extractS3KeyFromUrl = (url) => {
    if (!url)
        return null;
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.includes(".s3.")) {
            return null;
        }
        return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    }
    catch {
        return null;
    }
};
const isHttpUrl = (value) => {
    if (!value)
        return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch {
        return false;
    }
};
const resolveGuestEmailQrUrl = (pngUrl, qrValue) => {
    if (isHttpUrl(pngUrl))
        return pngUrl || "";
    if (isHttpUrl(qrValue))
        return qrValue || "";
    return "";
};
const prepareEmailLambdaAttachments = async (ivUrl, eventId, eventName) => {
    if (!ivUrl || !eventId)
        return [];
    const safeEventName = eventName.replace(/[^a-zA-Z0-9-_]/g, "_");
    const compressedKey = `events/${eventId}/email_attachment.jpg`;
    try {
        await s3.send(new client_s3_1.HeadObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: compressedKey,
        }));
        return [
            {
                filename: `${safeEventName}_invitation.jpg`,
                s3Key: compressedKey,
                contentType: "image/jpeg",
            },
        ];
    }
    catch {
        // Cache miss, continue to compress and upload.
    }
    const existingS3Key = extractS3KeyFromUrl(ivUrl);
    try {
        const response = await (0, node_fetch_1.default)(ivUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch IV attachment: ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const compressedBuffer = await (0, sharp_1.default)(buffer)
            .resize(800, 600, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 60 })
            .toBuffer();
        await s3.send(new client_s3_1.PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: compressedKey,
            Body: compressedBuffer,
            ContentType: "image/jpeg",
        }));
        return [
            {
                filename: `${safeEventName}_invitation.jpg`,
                s3Key: compressedKey,
                contentType: "image/jpeg",
            },
        ];
    }
    catch (error) {
        console.error("❌ Failed to prepare IV attachment for email lambda:", error);
        if (!existingS3Key) {
            return [];
        }
        return [
            {
                filename: `${safeEventName}_invitation.${resolveAttachmentExtension(inferImageContentType(ivUrl))}`,
                s3Key: existingS3Key,
                contentType: inferImageContentType(ivUrl),
            },
        ];
    }
};
const invokeEmailLambdaDirect = async (payload, retries = 5) => {
    if (!process.env.EMAIL_LAMBDA_FUNCTION_NAME) {
        throw new Error("EMAIL_LAMBDA_FUNCTION_NAME is not configured");
    }
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await (0, lambdaUtils_1.invokeLambda)(process.env.EMAIL_LAMBDA_FUNCTION_NAME, payload, true);
            return;
        }
        catch (error) {
            if (attempt >= retries) {
                throw error;
            }
            const backoff = Math.min(8000, 500 * Math.pow(2, attempt - 1));
            const jitter = Math.floor(Math.random() * 200);
            await sleep(backoff + jitter);
        }
    }
};
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
        const eventDate = event.date;
        const iv = event.iv;
        // Block duplicate names within the same event (case/space insensitive)
        const normalizedFullname = normalizeName(fullname);
        const existingGuest = await guestmodel_1.Guest.findOne({
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
        const newGuest = new guestmodel_1.Guest({
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
            const lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.QR_LAMBDA_FUNCTION_NAME, lambdaPayload);
            // Parse the nested response structure
            let parsedBody;
            if (lambdaResponse.body) {
                if (typeof lambdaResponse.body === "string") {
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
            // Extract QR data from parsed body
            qrSvg = parsedBody?.qrSvg;
            qrCodeUrl = parsedBody?.qrCodeUrl;
        }
        catch (lambdaError) {
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
                }
                else {
                    const pngLambdaResp = await (0, lambdaUtils_1.invokeLambda)(pngLambdaName, {
                        guestId: savedGuest._id.toString(),
                        eventId,
                        svg: qrSvg,
                        qrCodeUrl,
                    });
                    let parsedPngResult = {};
                    try {
                        parsedPngResult = pngLambdaResp?.body
                            ? typeof pngLambdaResp.body === "string"
                                ? JSON.parse(pngLambdaResp.body)
                                : pngLambdaResp.body
                            : pngLambdaResp || {};
                    }
                    catch (parseErr) {
                        console.warn("Failed to parse PNG lambda response body:", parseErr, pngLambdaResp);
                        parsedPngResult = pngLambdaResp || {};
                    }
                    const pngUrl = parsedPngResult?.pngUrl || parsedPngResult?.url || "";
                    if (pngUrl) {
                        savedGuest.pngUrl = pngUrl;
                        await savedGuest.save();
                    }
                }
            }
            catch (pngError) {
                console.error("❌ PNG generation/upload failed:", pngError);
            }
        }
        // --- Email Sending ---
        let emailSent = false;
        let emailErrorMessage = null;
        if (email) {
            try {
                const finalQrUrl = resolveGuestEmailQrUrl(savedGuest.pngUrl, savedGuest.qrCode);
                const attachments = await prepareEmailLambdaAttachments(iv, eventId, eventName);
                const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${savedGuest._id.toString()}`;
                const emailContent = (0, buildInvitationEmail_js_1.buildInvitationEmail)({
                    fullname,
                    message,
                    eventName,
                    eventDate,
                    qrCodeCenterColor,
                    finalQrUrl,
                    downloadUrl,
                });
                await invokeEmailLambdaDirect({
                    to: email,
                    from: `SoftInvites <info@softinvite.com>`,
                    subject: `${eventName}`,
                    htmlContent: emailContent,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    eventId: String(eventId),
                    messageType: "guest-invitation",
                    diagnosticContext: {
                        source: "guestController.addGuest",
                        guestId: savedGuest._id.toString(),
                        trigger: "guest-created",
                    },
                });
                emailSent = true;
            }
            catch (emailError) {
                console.error("Failed to send email:", emailError);
                emailErrorMessage =
                    emailError instanceof Error ? emailError.message : String(emailError);
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
            console.error("Backup Lambda failed:", backupError);
        }
        res.status(201).json({
            message: "Guest created successfully",
            guest: savedGuest,
            emailSent,
            ...(emailErrorMessage ? { emailError: emailErrorMessage } : {}),
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
        // --- Check Event Existence ---
        const event = await eventmodel_1.Event.findById(eventId || guest.eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const eventName = event.name;
        const eventDate = event.date;
        const iv = event.iv;
        const targetEventId = eventId || guest.eventId;
        // Prevent duplicate names within the same event when updating
        if (fullname !== undefined) {
            const cleanedName = String(fullname).trim().replace(/\s+/g, " ");
            const normalizedFullname = normalizeName(cleanedName);
            const duplicate = await guestmodel_1.Guest.findOne({
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
        const qrColorsChanged = (qrCodeBgColor !== undefined && qrCodeBgColor !== guest.qrCodeBgColor) ||
            (qrCodeCenterColor !== undefined &&
                qrCodeCenterColor !== guest.qrCodeCenterColor) ||
            (qrCodeEdgeColor !== undefined &&
                qrCodeEdgeColor !== guest.qrCodeEdgeColor);
        // Update guest fields only if provided (proper optional field handling)
        if (eventId !== undefined)
            guest.eventId = eventId;
        if (TableNo !== undefined)
            guest.TableNo = TableNo;
        if (email !== undefined)
            guest.email = email;
        if (phone !== undefined)
            guest.phone = phone;
        if (message !== undefined) {
            guest.message = (0, sanitize_html_1.default)(message, {
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
        if (others !== undefined)
            guest.others = others;
        let qrCodeUrl = guest.qrCode;
        let qrCodeRegenerated = false;
        // --- REGENERATE QR CODE IF MISSING ---
        if (!guest.qrCode) {
            // console.log("🔄 QR code missing in database, generating now...");
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
            // console.log("📤 Generating missing QR code:", lambdaPayload);
            let qrSvg, lambdaResponse;
            try {
                lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.QR_LAMBDA_FUNCTION_NAME, lambdaPayload);
                // console.log("✅ Lambda Response for missing QR:", JSON.stringify(lambdaResponse, null, 2));
                // Parse the nested response structure (same as addGuest)
                let parsedBody;
                if (lambdaResponse.body) {
                    if (typeof lambdaResponse.body === "string") {
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
                // console.log("🔍 Parsed Lambda Body:", parsedBody);
                // Extract QR data from parsed body (same as addGuest)
                qrSvg = parsedBody?.qrSvg;
                qrCodeUrl = parsedBody?.qrCodeUrl;
                if (qrCodeUrl) {
                    guest.qrCode = qrCodeUrl;
                    guest.qrCodeData = guest._id.toString();
                    qrCodeRegenerated = true;
                    // console.log("💾 Saved regenerated QR code to guest");
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
                }
                else {
                    const pngLambdaResp = await (0, lambdaUtils_1.invokeLambda)(pngLambdaName, {
                        guestId: guest._id.toString(),
                        eventId: (guest.eventId || eventId),
                    });
                    let parsedPngResult = {};
                    try {
                        parsedPngResult = pngLambdaResp?.body
                            ? typeof pngLambdaResp.body === "string"
                                ? JSON.parse(pngLambdaResp.body)
                                : pngLambdaResp.body
                            : pngLambdaResp || {};
                    }
                    catch (parseErr) {
                        console.warn("Failed to parse PNG lambda response body:", parseErr);
                        parsedPngResult = pngLambdaResp || {};
                    }
                    const pngUrl = parsedPngResult?.pngUrl || parsedPngResult?.url || "";
                    if (pngUrl) {
                        guest.pngUrl = pngUrl;
                        await guest.save();
                    }
                }
            }
            catch (e) {
                console.error("Failed to generate PNG for QR:", e);
            }
        }
        // Use QR code URL (either existing or newly generated)
        qrCodeUrl = guest.qrCode;
        // console.log("📄 Final QR code URL:", qrCodeUrl);
        // --- Email Sending ---
        let emailSent = false;
        let emailErrorMessage = null;
        const shouldSendUpdatedEmail = !!guest.email &&
            (emailChanged ||
                qrCodeRegenerated ||
                fullname !== undefined ||
                TableNo !== undefined ||
                phone !== undefined ||
                message !== undefined ||
                others !== undefined ||
                eventId !== undefined ||
                qrColorsChanged);
        if (shouldSendUpdatedEmail && guest.email) {
            try {
                const finalQrUrl = resolveGuestEmailQrUrl(guest.pngUrl, guest.qrCode);
                const attachments = await prepareEmailLambdaAttachments(iv, String(targetEventId), eventName);
                const downloadUrl = `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id.toString()}`;
                const emailContent = (0, buildInvitationEmail_js_1.buildInvitationEmail)({
                    fullname: guest.fullname,
                    message: guest.message || "You're invited!",
                    eventName,
                    eventDate,
                    qrCodeCenterColor: guest.qrCodeCenterColor || "0,0,0",
                    finalQrUrl,
                    downloadUrl,
                });
                await invokeEmailLambdaDirect({
                    to: guest.email,
                    from: `SoftInvites <info@softinvite.com>`,
                    subject: `${eventName}`,
                    htmlContent: emailContent,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    eventId: String(targetEventId),
                    messageType: "guest-invitation-update",
                    diagnosticContext: {
                        source: "guestController.updateGuest",
                        guestId: guest._id.toString(),
                        trigger: qrCodeRegenerated ? "qr-regenerated" : "guest-updated",
                    },
                });
                emailSent = true;
            }
            catch (emailError) {
                console.error("❌ Failed to send email:", emailError);
                emailErrorMessage =
                    emailError instanceof Error ? emailError.message : String(emailError);
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
            ...(emailErrorMessage ? { emailError: emailErrorMessage } : {}),
            qrCodeAvailable: !!qrCodeUrl,
            qrCodeRegenerated: qrCodeRegenerated,
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
        await new Promise((resolve) => setTimeout(resolve, 3000));
        // Trigger import Lambda asynchronously
        await (0, lambdaUtils_1.invokeLambda)(process.env.IMPORT_LAMBDA_FUNCTION_NAME, {
            fileUrl,
            eventId,
            userEmail,
        }, true);
        res.status(202).json({
            message: "Import job is running. You will receive an email when processing completes.",
            fileUrl,
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
// New endpoint for QR scanner with timestamp
const checkInGuest = async (req, res) => {
    try {
        const { id } = req.params;
        const { checkedInBy } = req.body;
        const guest = await guestmodel_1.Guest.findById(id);
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
    }
    catch (error) {
        console.error("❌ Error in checkInGuest:", error);
        res.status(500).json({
            message: "Error checking in guest",
            error: error instanceof Error ? error.message : error,
        });
    }
};
exports.checkInGuest = checkInGuest;
const downloadQRCode = async (req, res) => {
    try {
        const { id } = req.params;
        const guest = await guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        if (guest.pngUrl) {
            res.setHeader("Content-Disposition", `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`);
            res.setHeader("Content-Type", "image/png");
            res.redirect(guest.pngUrl);
            return;
        }
        const fallbackPngUrl = buildPngUrl(guest.eventId?.toString(), guest._id.toString());
        if (fallbackPngUrl) {
            res.setHeader("Content-Disposition", `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`);
            res.setHeader("Content-Type", "image/png");
            res.redirect(fallbackPngUrl);
            return;
        }
        res.status(404).json({ message: "PNG QR code not available" });
    }
    catch (error) {
        console.error("❌ Error in downloadQRCode:", error);
        res.status(500).json({
            message: "Error downloading QR code",
            error: error instanceof Error ? error.message : "Unknown error",
        });
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
        const qrItems = guests.map((guest) => ({
            guestId: guest._id.toString(),
            guestName: guest.fullname || "Guest",
            tableNo: guest.TableNo || "NoTable",
            others: guest.others || "-",
            pngUrl: guest.pngUrl || buildPngUrl(eventId, guest._id.toString()) || "",
        }));
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
        const zipUrl = parsedBody.zipUrl ||
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
        const qrItems = guests.map((guest) => ({
            guestId: guest._id.toString(),
            guestName: guest.fullname || "Guest",
            tableNo: guest.TableNo || "NoTable",
            others: guest.others || "-",
            pngUrl: guest.pngUrl || buildPngUrl(eventId, guest._id.toString()) || "",
        }));
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
        const zipUrl = parsedBody.zipUrl ||
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
        const guest = await guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        if (guest.pngUrl) {
            res.setHeader("Content-Disposition", `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`);
            res.setHeader("Content-Type", "image/png");
            res.redirect(guest.pngUrl);
            return;
        }
        const fallbackPngUrl = buildPngUrl(guest.eventId?.toString(), guest._id.toString());
        if (fallbackPngUrl) {
            res.setHeader("Content-Disposition", `attachment; filename=\"qr-${guest.fullname || "guest"}.png\"`);
            res.setHeader("Content-Type", "image/png");
            res.redirect(fallbackPngUrl);
            return;
        }
        res.status(404).json({ message: "PNG QR code not available" });
    }
    catch (error) {
        console.error("❌ Error in downloadEmailQRCode:", error);
        res.status(500).json({
            message: "Error downloading QR code",
            error: error instanceof Error ? error.message : "Unknown error",
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
        await lambdaClient.send(new client_lambda_1.InvokeCommand({
            FunctionName: process.env.BACKUP_LAMBDA,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({})),
        }));
        res.status(200).json({
            message: "All guests and their QR codes deleted successfully",
            deletedCount: guests.length,
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
            res
                .status(400)
                .json({ message: "start and end query params are required" });
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
            createdAt: { $gte: startDate, $lte: endDate },
        });
        await lambdaClient.send(new client_lambda_1.InvokeCommand({
            FunctionName: process.env.BACKUP_LAMBDA,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({})),
        }));
        res.status(200).json({
            message: `Deleted ${deleteResult.deletedCount} guests for event ${eventId}`,
        });
    }
    catch (error) {
        console.error("Error deleting guests by event + timestamp:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
exports.deleteGuestsByEventAndTimestamp = deleteGuestsByEventAndTimestamp;
const deleteSelectedGuests = async (req, res) => {
    try {
        const { guestIds } = req.body;
        if (!guestIds || !Array.isArray(guestIds) || guestIds.length === 0) {
            res.status(400).json({ message: "Guest IDs array is required" });
            return;
        }
        const guests = await guestmodel_1.Guest.find({
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
                    await (0, s3Utils_1.deleteFromS3)(key);
                }
                catch (err) {
                    console.error(`Failed to delete QR for ${guest.fullname}:`, err);
                }
            }
        });
        await Promise.allSettled(deletionPromises);
        const deleteResult = await guestmodel_1.Guest.deleteMany({
            _id: { $in: guestIds },
        });
        await lambdaClient.send(new client_lambda_1.InvokeCommand({
            FunctionName: process.env.BACKUP_LAMBDA,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({})),
        }));
        res.status(200).json({
            message: `Successfully deleted ${deleteResult.deletedCount} guests`,
            deletedCount: deleteResult.deletedCount,
        });
    }
    catch (error) {
        console.error("Error deleting selected guests:", error);
        res.status(500).json({ message: "Error deleting selected guests" });
    }
};
exports.deleteSelectedGuests = deleteSelectedGuests;
const scanQRCode = async (req, res) => {
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
        const guest = await guestmodel_1.Guest.findById(guestId);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        const event = await eventmodel_1.Event.findById(guest.eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            try {
                const decodedToken = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
                const authorizedEventId = decodedToken.eventId;
                if (authorizedEventId &&
                    guest.eventId.toString() !== authorizedEventId) {
                    res.status(403).json({
                        message: "This guest belongs to a different event",
                        guestEvent: guest.eventId.toString(),
                        scannerEvent: authorizedEventId,
                    });
                    return;
                }
            }
            catch (tokenError) {
                console.warn("Invalid token provided, continuing without event validation:", tokenError);
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
    }
    catch (error) {
        console.error("🚨 Error during check-in:", error);
        res.status(500).json({ message: "Server error during check-in" });
    }
};
exports.scanQRCode = scanQRCode;
const generateAnalytics = async (req, res) => {
    try {
        const totalEvents = await eventmodel_1.Event.countDocuments();
        const totalGuests = await guestmodel_1.Guest.countDocuments();
        const checkedInGuests = await guestmodel_1.Guest.countDocuments({
            checkedIn: true,
        });
        const unusedCodes = totalGuests - checkedInGuests;
        const guestStatusBreakdownRaw = await guestmodel_1.Guest.aggregate([
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
        const checkInTrendRaw = await guestmodel_1.Guest.aggregate([
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
        const event = await eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ eventId: eventId, role: "temp", type: "checkin" }, process.env.JWT_SECRET, { expiresIn: "72h" });
        const tempLink = `${process.env.FRONTEND_URL}/guest?token=${token}`;
        res.status(200).json({ tempLink });
    }
    catch (error) {
        console.error("Error generating temp link:", error);
        res.status(500).json({ message: "Error generating temp link" });
    }
};
exports.generateTempLink = generateTempLink;
const restoreGuestsAndRegenerateQRCodes = async (req, res) => {
    try {
        const { key, eventId } = req.body;
        if (!key || !eventId) {
            return res.status(400).json({
                message: "Both 'key' (S3 path) and 'eventId' are required.",
            });
        }
        console.time("CompleteRestoreProcess");
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
        const eventGuests = allGuests.filter((g) => g.eventId === eventId);
        if (eventGuests.length === 0) {
            return res.status(404).json({
                message: `No guests found for event: ${eventId}`,
            });
        }
        const existingGuests = await guestmodel_1.Guest.find({
            eventId: new mongoose_1.Types.ObjectId(eventId),
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
                _id: guest._id ? new mongoose_1.Types.ObjectId(guest._id) : new mongoose_1.Types.ObjectId(),
                ...guest,
                fullname: guest.fullname || "Unknown Guest",
                eventId: new mongoose_1.Types.ObjectId(eventId),
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
            const existingGuestsForQR = await guestmodel_1.Guest.find({
                eventId: new mongoose_1.Types.ObjectId(eventId),
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
            insertedGuests = await guestmodel_1.Guest.insertMany(guestsToInsert, {
                ordered: false,
            });
        }
        catch (insertError) {
            console.error("❌ Database insert failed:", insertError);
            throw insertError;
        }
        const allGuestsForQR = await guestmodel_1.Guest.find({
            eventId: new mongoose_1.Types.ObjectId(eventId),
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
    }
    catch (error) {
        console.timeEnd("CompleteRestoreProcess");
        console.error("❌ Error in complete restore process:", error);
        res.status(500).json({
            message: "Internal server error during complete restore process.",
            error: error.message,
        });
    }
};
exports.restoreGuestsAndRegenerateQRCodes = restoreGuestsAndRegenerateQRCodes;
const regenerateQRCodes = async (guests) => {
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
            const lambdaResponse = await (0, lambdaUtils_1.invokeLambda)(process.env.QR_LAMBDA_FUNCTION_NAME, lambdaPayload);
            let parsedBody;
            if (lambdaResponse.body) {
                parsedBody =
                    typeof lambdaResponse.body === "string"
                        ? JSON.parse(lambdaResponse.body)
                        : lambdaResponse.body;
            }
            else {
                parsedBody = lambdaResponse;
            }
            const qrCodeUrl = parsedBody?.qrCodeUrl;
            if (!qrCodeUrl) {
                throw new Error("No QR code URL returned from Lambda");
            }
            await guestmodel_1.Guest.updateOne({ _id: guest._id }, {
                $set: {
                    qrCode: qrCodeUrl,
                    qrCodeData: guest._id.toString(),
                    updatedAt: new Date(),
                },
            });
            regeneratedCount++;
        }
        catch (error) {
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
const streamToString = (stream) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
};
const testDatabase = async (req, res) => {
    try {
        const { eventId } = req.params;
        const existingGuests = await guestmodel_1.Guest.find({
            eventId: new mongoose_1.Types.ObjectId(eventId),
        }).lean();
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
            qrCodeEdgeColor: "0,0,0",
        };
        const testGuest = await guestmodel_1.Guest.create(testGuestData);
        const verifiedGuest = await guestmodel_1.Guest.findById(testGuest._id);
        res.status(200).json({
            message: "Database test successful",
            readCount: existingGuests.length,
            writeVerified: !!verifiedGuest,
            testGuestId: testGuest._id,
        });
    }
    catch (error) {
        console.error("❌ Database test failed:", error);
        res.status(500).json({
            message: "Database test failed",
            error: error.message,
        });
    }
};
exports.testDatabase = testDatabase;
const checkQRCodeStatus = async (req, res) => {
    try {
        const { eventId } = req.params;
        const guests = await guestmodel_1.Guest.find({
            eventId: new mongoose_1.Types.ObjectId(eventId),
        })
            .select("fullname qrCode qrCodeData")
            .lean();
        const results = [];
        for (const guest of guests) {
            let status = "unknown";
            let accessible = false;
            if (guest.qrCode) {
                try {
                    const response = await (0, node_fetch_1.default)(guest.qrCode, { method: "HEAD" });
                    accessible = response.ok;
                    status = accessible ? "accessible" : "inaccessible";
                }
                catch (error) {
                    status = "error";
                    accessible = false;
                }
            }
            else {
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
    }
    catch (error) {
        console.error("❌ Error checking QR codes:", error);
        res.status(500).json({
            message: "Internal server error",
            error: error.message,
        });
    }
};
exports.checkQRCodeStatus = checkQRCodeStatus;
const resendAllEmails = async (req, res) => {
    try {
        const { eventId } = req.params;
        if (!eventId) {
            res.status(400).json({ message: "Event ID is required" });
            return;
        }
        const event = await eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const guestsWithEmail = await guestmodel_1.Guest.countDocuments({
            eventId,
            email: { $exists: true, $ne: "" },
        });
        if (guestsWithEmail === 0) {
            res.status(404).json({ message: "No guests with email addresses found" });
            return;
        }
        // Trigger resend emails Lambda asynchronously
        await (0, lambdaUtils_1.invokeLambda)(process.env.RESEND_EMAILS_LAMBDA_FUNCTION_NAME, { eventId }, true);
        res.status(202).json({
            message: `Email resend job started for ${guestsWithEmail} guests. Admin will receive notification when complete.`,
            eventName: event.name,
            guestsWithEmail,
        });
    }
    catch (error) {
        console.error("❌ Error starting resend emails job:", error);
        res.status(500).json({
            message: "Error starting resend emails job",
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
};
exports.resendAllEmails = resendAllEmails;
