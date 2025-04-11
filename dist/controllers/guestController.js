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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTempLink = exports.generateAnalytics = exports.scanQRCode = exports.deleteGuestsByEvent = exports.deleteGuestById = exports.getGuestById = exports.getGuestsByEvent = exports.downloadAllQRCodes = exports.downloadQRCode = exports.updateGuest = exports.importGuests = exports.addGuest = void 0;
const guestmodel_1 = require("../models/guestmodel");
const eventmodel_1 = require("../models/eventmodel");
const qrcode_svg_1 = __importDefault(require("qrcode-svg"));
const archiver_1 = __importDefault(require("archiver"));
const xlsx_1 = __importDefault(require("xlsx"));
const fastcsv = __importStar(require("fast-csv"));
const uploadImage_1 = require("../library/helpers/uploadImage");
const utils_1 = require("../utils/utils");
const stream_1 = __importDefault(require("stream"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const emailService_1 = require("../library/helpers/emailService");
const colorUtils_1 = require("../utils/colorUtils");
const sharp_1 = __importDefault(require("sharp"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// **Add a Guest & Generate QR Code**
const addGuest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, phone, eventId, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor, } = req.body;
        // Validate input
        const validateGuest = utils_1.createGuestSchema.validate(req.body, utils_1.option);
        if (validateGuest.error) {
            res.status(400).json({ Error: validateGuest.error.details[0].message });
            return;
        }
        const event = yield eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const eventName = event.name;
        const eventDate = event.date;
        const eventLocation = event.location;
        const bgColorHex = (0, colorUtils_1.rgbToHex)(qrCodeBgColor);
        const centerColorHex = (0, colorUtils_1.rgbToHex)(qrCodeCenterColor);
        const edgeColorHex = (0, colorUtils_1.rgbToHex)(qrCodeEdgeColor);
        const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}`;
        // Generate SVG QR Code
        const qr = new qrcode_svg_1.default({
            content: qrCodeData,
            padding: 4,
            width: 256,
            height: 256,
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
        const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg)).png().toBuffer();
        // Upload to Cloudinary (wrapped in a Promise)
        const qrCodeUrl = yield new Promise((resolve, reject) => {
            const uploadStream = uploadImage_1.cloudinary.uploader.upload_stream({
                folder: "qr_codes",
                public_id: `${firstName}_${lastName}_qr`,
                overwrite: true,
                format: "png",
            }, (error, result) => {
                if (error || !(result === null || result === void 0 ? void 0 : result.secure_url)) {
                    return reject(error);
                }
                resolve(result.secure_url);
            });
            uploadStream.end(pngBuffer);
        });
        // Save guest with QR Code URL
        const newGuest = new guestmodel_1.Guest(Object.assign(Object.assign({ firstName,
            lastName, qrCode: qrCodeUrl, qrCodeData,
            qrCodeBgColor,
            qrCodeCenterColor,
            qrCodeEdgeColor,
            eventId }, (phone && { phone })), (email && { email })));
        yield newGuest.save();
        if (email) {
            const emailContent = `
        <h2>Welcome to ${eventName}!</h2>
        <p>Dear ${firstName},</p>
        <p>We are delighted to invite you to <strong>${eventName}</strong>.</p>
        <h3>Event Details:</h3>
        <p><strong>Date:</strong> ${eventDate}</p>
        <p><strong>Location:</strong> ${event.location}</p>
        <p><strong>Description:</strong> ${event.description}</p>
        <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
        <img src="${qrCodeUrl}" alt="QR Code" />
        <p>See you at ${eventName}!</p>
      `;
            try {
                yield (0, emailService_1.sendEmail)(email, `Your Invitation to ${eventName}`, emailContent);
                console.log("Email sent successfully!");
            }
            catch (emailError) {
                console.error("Error sending email:", emailError);
            }
        }
        res.status(201).json({ message: "Guest created successfully", guest: newGuest });
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error creating guest", error });
    }
});
exports.addGuest = addGuest;
// ✅ Import Guests from CSV/Excel and delete from Cloudinary
const importGuests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const uploadResponse = yield uploadImage_1.cloudinary.uploader.upload(req.file.path, {
            resource_type: "raw",
            folder: "uploads",
        });
        const fileUrl = uploadResponse.secure_url;
        const publicId = uploadResponse.public_id;
        const guests = [];
        if (req.file.mimetype === "text/csv") {
            const fetchResponse = yield (0, node_fetch_1.default)(fileUrl);
            const csvData = yield fetchResponse.text();
            fastcsv
                .parseString(csvData, { headers: true })
                .on("data", (row) => guests.push(row))
                .on("end", () => __awaiter(void 0, void 0, void 0, function* () {
                try {
                    yield processGuests(guests, res);
                }
                finally {
                    yield uploadImage_1.cloudinary.uploader.destroy(publicId);
                }
            }))
                .on("error", (err) => __awaiter(void 0, void 0, void 0, function* () {
                console.error("CSV parsing error:", err);
                yield uploadImage_1.cloudinary.uploader.destroy(publicId);
                res.status(500).json({ message: "Error parsing CSV file" });
            }));
        }
        else if (req.file.mimetype.includes("spreadsheet")) {
            const fetchResponse = yield (0, node_fetch_1.default)(fileUrl);
            const arrayBuffer = yield fetchResponse.arrayBuffer();
            const excelData = Buffer.from(arrayBuffer);
            const workbook = xlsx_1.default.read(excelData);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx_1.default.utils.sheet_to_json(sheet);
            guests.push(...data);
            try {
                yield processGuests(guests, res);
            }
            finally {
                yield uploadImage_1.cloudinary.uploader.destroy(publicId);
            }
        }
        else {
            yield uploadImage_1.cloudinary.uploader.destroy(publicId);
            res.status(400).json({ message: "Invalid file type" });
        }
    }
    catch (error) {
        console.error("Error importing guests:", error);
        res.status(500).json({ message: "Error importing guests" });
    }
});
exports.importGuests = importGuests;
// ✅ Process Imported Guests from CSV/Excel
const processGuests = (guests, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const guestPromises = guests.map((guest) => __awaiter(void 0, void 0, void 0, function* () {
            const { firstName, lastName, email, phone, eventId, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor, } = guest;
            const event = yield eventmodel_1.Event.findById(eventId);
            if (!event)
                return null;
            const eventName = event.name;
            const eventDate = event.date;
            const eventLocation = event.location;
            const bgColorHex = (0, colorUtils_1.rgbToHex)(qrCodeBgColor);
            const centerColorHex = (0, colorUtils_1.rgbToHex)(qrCodeCenterColor);
            const edgeColorHex = (0, colorUtils_1.rgbToHex)(qrCodeEdgeColor);
            const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}`;
            const qr = new qrcode_svg_1.default({
                content: qrCodeData,
                padding: 4,
                width: 256,
                height: 256,
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
            const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg)).png().toBuffer();
            return new Promise((resolve, reject) => {
                uploadImage_1.cloudinary.uploader
                    .upload_stream({
                    folder: "qr_codes",
                    public_id: `${firstName}_${lastName}_qr`,
                    overwrite: true,
                    format: "png",
                }, (error, result) => __awaiter(void 0, void 0, void 0, function* () {
                    if (error) {
                        console.error("Cloudinary Upload Error:", error);
                        reject(error);
                        return;
                    }
                    const qrCodeUrl = result === null || result === void 0 ? void 0 : result.secure_url;
                    try {
                        const newGuest = new guestmodel_1.Guest(Object.assign(Object.assign({ firstName,
                            lastName,
                            eventId, qrCode: qrCodeUrl, qrCodeData,
                            qrCodeBgColor,
                            qrCodeCenterColor,
                            qrCodeEdgeColor, imported: true }, (email && { email })), (phone && { phone })));
                        yield newGuest.save();
                        if (email) {
                            const emailContent = `
                    <h2>Welcome to ${eventName}!</h2>
                    <p>Dear ${firstName},</p>
                    <p>We are delighted to invite you to <strong>${eventName}</strong>.</p>

                    <h3>Event Details:</h3>
                    <p><strong>Date:</strong> ${eventDate}</p>
                    <p><strong>Location:</strong> ${event.location}</p>
                    <p><strong>Description:</strong> ${event.description}</p>

                    <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
                    <img src="${qrCodeUrl}" alt="QR Code" />

                    <p>See you at ${eventName}!</p>
                  `;
                            yield (0, emailService_1.sendEmail)(email, `Your Invitation to ${eventName}`, emailContent);
                        }
                        resolve({ email, success: true });
                    }
                    catch (saveError) {
                        console.error("Error saving guest:", saveError);
                        reject(saveError);
                    }
                }))
                    .end(pngBuffer);
            });
        }));
        const results = yield Promise.allSettled(guestPromises);
        const successCount = results.filter((r) => r.status === "fulfilled").length - 1;
        res.status(201).json({
            message: `${successCount} guests imported successfully`,
            errors: results
                .filter((r) => r.status === "rejected")
                .map((err) => err.reason),
        });
    }
    catch (error) {
        console.error("Error processing imported guests:", error);
        res.status(500).json({ message: "Error processing imported guests", error });
    }
});
const updateGuest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // const { firstName, lastName, email, phone, eventId } = req.body;
        // Validate the input
        const validateGuest = utils_1.updateGuestSchema.validate(req.body, utils_1.option);
        if (validateGuest.error) {
            res.status(400).json({ Error: validateGuest.error.details[0].message });
            return;
        }
        // Find the guest by ID
        const guest = yield guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Get the event details for QR code info
        const event = yield eventmodel_1.Event.findById(guest.eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const eventName = event.name;
        const eventDate = event.date;
        const eventLocation = event.location;
        const eventDescription = event.description;
        // ✅ Update the guest and get the updated record
        const updatedGuest = yield guestmodel_1.Guest.findByIdAndUpdate(id, req.body, {
            new: true, // Return updated guest
        });
        if (!updatedGuest) {
            res.status(404).json({ message: "Guest not found after update" });
            return;
        }
        // ✅ Use updated values for QR code, fallback to existing values if not updated
        const updatedFirstName = updatedGuest.firstName;
        const updatedLastName = updatedGuest.lastName;
        const qrCodeData = `First Name: ${updatedFirstName}\nLast Name: ${updatedLastName}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nEvent Description: ${eventDescription}`;
        // ✅ Generate SVG QR Code
        const qr = new qrcode_svg_1.default({
            content: qrCodeData,
            padding: 4,
            width: 256,
            height: 256,
            color: (0, colorUtils_1.rgbToHex)(updatedGuest.qrCodeEdgeColor),
            background: (0, colorUtils_1.rgbToHex)(updatedGuest.qrCodeBgColor),
            xmlDeclaration: false,
        });
        let svg = qr.svg();
        // ✅ Insert the gradient in <defs>
        svg = svg.replace(/<svg([^>]*)>/, `<svg$1>
      <defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="${(0, colorUtils_1.rgbToHex)(updatedGuest.qrCodeCenterColor)}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${(0, colorUtils_1.rgbToHex)(updatedGuest.qrCodeEdgeColor)}" stop-opacity="1"/>
        </radialGradient>
      </defs>`);
        // ✅ Apply gradient to QR squares
        svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
            const isBoundingRect = /x="0".*y="0"/.test(group1);
            return isBoundingRect
                ? `<rect${group1}style="fill:${(0, colorUtils_1.rgbToHex)(updatedGuest.qrCodeBgColor)};${group2}"/>`
                : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        });
        // ✅ Convert SVG to PNG using sharp
        const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg)).png().toBuffer();
        // ✅ Upload PNG to Cloudinary
        const uploadResponse = yield uploadImage_1.cloudinary.uploader.upload_stream({
            folder: "qr_codes",
            public_id: `${updatedFirstName}_${updatedLastName}_qr`, // ✅ Updated names for file
            overwrite: true,
            format: "png",
        }, (error, result) => __awaiter(void 0, void 0, void 0, function* () {
            if (error) {
                console.error("Cloudinary Upload Error:", error);
                res.status(500).json({ message: "Error uploading QR code", error });
                return;
            }
            const qrCodeUrl = result === null || result === void 0 ? void 0 : result.secure_url;
            // ✅ Update guest with new QR Code URL
            updatedGuest.qrCode = qrCodeUrl !== null && qrCodeUrl !== void 0 ? qrCodeUrl : updatedGuest.qrCode;
            const email = updatedGuest.email;
            try {
                yield updatedGuest.save();
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
                yield (0, emailService_1.sendEmail)(email, `Your Updated QR Code for ${eventName}`, emailContent)
                    .then(() => console.log("Email sent successfully!"))
                    .catch((error) => console.error("Error sending email:", error));
                res.status(200).json({
                    message: "Guest updated successfully and notified via email",
                    guest: updatedGuest,
                });
            }
            catch (saveError) {
                console.error("Error saving updated guest:", saveError);
                res.status(500).json({ message: "Error saving guest", saveError });
            }
        }));
        uploadResponse.end(pngBuffer);
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error updating guest", error });
    }
});
exports.updateGuest = updateGuest;
const downloadQRCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const guest = yield guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        const event = yield eventmodel_1.Event.findById(guest.eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const eventName = event.name;
        const eventDate = event.date;
        const eventLocation = event.location;
        const eventDescription = event.description;
        const bgColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeBgColor);
        const centerColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeCenterColor);
        const edgeColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeEdgeColor);
        const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nEvent Description: ${eventDescription}`;
        const qr = new qrcode_svg_1.default({
            content: qrCodeData,
            padding: 4,
            width: 256,
            height: 256,
            color: edgeColorHex,
            background: bgColorHex,
            xmlDeclaration: false,
        });
        let svg = qr.svg();
        svg = svg.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="grad1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style="stop-color:${centerColorHex}; stop-opacity:1" />
          <stop offset="100%" style="stop-color:${edgeColorHex}; stop-opacity:1" />
        </radialGradient>
      </defs>
      `);
        svg = svg.replace(/fill="[^"]+"/g, 'fill="url(#grad1)"');
        // Convert SVG to PNG buffer
        const svgBuffer = Buffer.from(svg);
        const pngBuffer = yield (0, sharp_1.default)(svgBuffer).png().toBuffer();
        // Set headers to force download
        res.setHeader("Content-Disposition", `attachment; filename="qr-${guest.firstName}-${guest.lastName}.png"`);
        res.setHeader("Content-Type", "image/png");
        // Send the PNG buffer
        res.send(pngBuffer);
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error downloading QR code" });
    }
});
exports.downloadQRCode = downloadQRCode;
const downloadAllQRCodes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        const guests = yield guestmodel_1.Guest.find({ eventId });
        if (guests.length === 0) {
            res.status(404).json({ message: "No guests found" });
            return;
        }
        // Create an in-memory ZIP archive
        const archive = (0, archiver_1.default)("zip", { zlib: { level: 9 } });
        const zipBufferStream = new stream_1.default.PassThrough();
        archive.pipe(zipBufferStream);
        // Generate and append QR codes to ZIP
        for (const guest of guests) {
            const event = yield eventmodel_1.Event.findById(guest.eventId);
            if (!event) {
                res.status(404).json({ message: "Event not found" });
                return;
            }
            const eventName = event.name;
            const eventDate = event.date;
            const eventLocation = event.location;
            const eventDescription = event.description;
            const bgColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeBgColor);
            const centerColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeCenterColor);
            const edgeColorHex = (0, colorUtils_1.rgbToHex)(guest.qrCodeEdgeColor);
            // ✅ Generate QR Code Data
            const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${eventLocation}\nEvent Description: ${eventDescription}`;
            // ✅ Generate SVG QR Code with Gradient
            const qr = new qrcode_svg_1.default({
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
            svg = svg.replace(/<svg([^>]*)>/, `<svg$1>
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
          </radialGradient>
        </defs>`);
            // Apply the gradient directly to QR code squares
            svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
                const isBoundingRect = /x="0".*y="0"/.test(group1);
                return isBoundingRect
                    ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
                    : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
            });
            // ✅ Convert SVG to Buffer (PNG format)
            const svgBuffer = Buffer.from(svg);
            const sharp = yield Promise.resolve().then(() => __importStar(require("sharp")));
            const pngBuffer = yield sharp.default(svgBuffer).png().toBuffer();
            archive.append(pngBuffer, {
                name: `${guest.firstName}-${guest.lastName}.png`,
            });
        }
        // Finalize archive
        yield archive.finalize();
        // Upload the ZIP to Cloudinary
        const uploadPromise = new Promise((resolve, reject) => {
            const uploadStream = uploadImage_1.cloudinary.uploader.upload_stream({ resource_type: "raw", folder: "qrcodes", format: "zip" }, (error, result) => {
                if (error) {
                    console.error("Cloudinary upload error:", error);
                    reject(error);
                }
                else if (result && result.secure_url) {
                    resolve(result.secure_url);
                }
                else {
                    reject(new Error("Invalid Cloudinary response"));
                }
            });
            zipBufferStream.pipe(uploadStream);
        });
        // Get the Cloudinary ZIP file URL
        const zipDownloadLink = yield uploadPromise;
        // Return the ZIP download link
        res.status(200).json({ zipDownloadLink });
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error generating ZIP file" });
    }
});
exports.downloadAllQRCodes = downloadAllQRCodes;
// **Get All Guests for an Event**
const getGuestsByEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        const guests = yield guestmodel_1.Guest.find({ eventId: eventId });
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
});
exports.getGuestsByEvent = getGuestsByEvent;
// **Get Single Guest for an Event**
const getGuestById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const guest = yield guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
        }
        res.status(200).json({ message: "Successfully fetched guest", guest });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching guest" });
    }
});
exports.getGuestById = getGuestById;
const deleteGuestById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        // Find the guest before deleting
        const guest = yield guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Extract the Cloudinary public ID from the QR code URL
        if (guest.qrCode) {
            const publicId = (_a = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)) === null || _a === void 0 ? void 0 : _a[1];
            if (publicId) {
                yield uploadImage_1.cloudinary.uploader.destroy(`qr_codes/${publicId}`);
            }
        }
        // Fully delete guest from database
        yield guestmodel_1.Guest.findByIdAndDelete(id);
        res.status(200).json({ message: "Guest deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting guest:", error);
        res.status(500).json({ message: "Error deleting guest" });
    }
});
exports.deleteGuestById = deleteGuestById;
// **Delete Guests by Event ID**
const deleteGuestsByEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        // Find all guests associated with the event
        const guests = yield guestmodel_1.Guest.find({ eventId });
        if (guests.length === 0) {
            res.status(404).json({ message: "No guests found for this event" });
            return;
        }
        // Delete all QR codes from Cloudinary in parallel
        const deletionPromises = guests.map((guest) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            if (guest.qrCode) {
                const publicId = (_a = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)) === null || _a === void 0 ? void 0 : _a[1];
                if (publicId) {
                    return uploadImage_1.cloudinary.uploader.destroy(`qr_codes/${publicId}`);
                }
            }
        }));
        yield Promise.allSettled(deletionPromises);
        // Ensure guests are fully removed from the database
        yield guestmodel_1.Guest.deleteMany({ eventId });
        res
            .status(200)
            .json({ message: "All guests and their QR codes deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting guests:", error);
        res.status(500).json({ message: "Error deleting guests" });
    }
});
exports.deleteGuestsByEvent = deleteGuestsByEvent;
// export const scanQRCode = async (req: Request, res: Response): Promise<void> => {
//   try {
//     let { qrData } = req.body;
//     console.log("QR Data received:", qrData);
//     if (!qrData) {
//       res.status(400).json({ message: "QR Code data is missing" });
//       return;
//     }
//     // Normalize line breaks to match stored data
//     qrData = qrData.replace(/\\n/g, "\n");
//     const guest = await Guest.findOne({ qrCodeData: qrData });
//     if (!guest) {
//       console.log("Stored QR Code does not match:", qrData);
//       res.status(404).json({ message: "Invalid QR Code" });
//       return;
//     }
//     if (guest.checkedIn) {
//       res.status(400).json({ message: "Guest already checked in" });
//       return;
//     }
//     guest.checkedIn = true;
//     guest.status = "checked-in";
//     await guest.save();
//     res.status(200).json({ message: "Guest checked in successfully", guest });
//   } catch (error) {
//     console.error("Scan QR Error:", error);
//     res.status(500).json({ message: "Error scanning QR code" });
//   }
// };
// **Generate Analytics (Used & Unused QR Codes)**
// export const scanQRCode = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { qrData } = req.body;
//     const guest = await Guest.findOne({
//       qrCodeData: new RegExp(`^${qrData.trim()}$`, "i"),
//     });
//     if (!guest) {
//       res.status(404).json({ message: "Guest not found for this event" });
//       return;
//     }
//     if (guest.checkedIn) {
//       res.status(200).json({ message: "Guest already checked in", guest });
//       return;
//     }
//     guest.checkedIn = true;
//     guest.status = "checked-in";
//     await guest.save();
//     res.status(200).json({ message: "Guest successfully checked in", guest });
//     return;
//   } catch (error) {
//     console.error("🚨 Error during check-in:", error);
//     res.status(500).json({ message: "Server error during check-in" });
//     return;
//   }
// };
// Helper function to parse the QR data (could be moved to a separate file)
const parseQrData = (qrData) => {
    const fields = {};
    // Split the QR data by newline and parse each line
    qrData.split("\n").forEach((line) => {
        const [key, ...rest] = line.split(":");
        if (key && rest.length > 0) {
            fields[key.trim()] = rest.join(":").trim();
        }
    });
    return fields;
};
const scanQRCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Extract qrData from the request body
        const { qrData } = req.body;
        // Check if QR data is provided
        if (!qrData) {
            res.status(400).json({ message: "QR Code data is missing" });
            return;
        }
        // Parse the QR data into fields
        const parsedQrData = parseQrData(qrData);
        const firstName = parsedQrData["First Name"];
        const lastName = parsedQrData["Last Name"];
        const eventName = parsedQrData["Event"];
        const eventDate = parsedQrData["Date"]; // Additional details you can store
        const eventLocation = parsedQrData["Location"]; // Additional details you can store
        // Validate that required fields are present
        if (!firstName || !lastName || !eventName || !eventDate || !eventLocation) {
            res.status(400).json({ message: "Missing required QR fields" });
            return;
        }
        // Query the database to find the guest based on the full QR data
        const guest = yield guestmodel_1.Guest.findOne({
            qrCodeData: new RegExp(`^${qrData.trim()}$`, "i"),
        });
        // If the guest is not found, return 404
        if (!guest) {
            res.status(404).json({ message: "Guest not found for this event" });
            return;
        }
        // If the guest is already checked in
        if (guest.checkedIn) {
            res.status(200).json({ message: "Guest already checked in", guest });
            return;
        }
        // Mark the guest as checked-in
        if (!guest.checkedIn) {
            guest.checkedIn = true;
            guest.status = "checked-in";
            console.log("🔁 Updating guest status to checked-in");
            const updatedGuest = yield guest.save();
            console.log("💾 Guest saved:", updatedGuest);
        }
        // Return success message
        res.status(200).json({ message: "Guest successfully checked in", guest });
        return;
    }
    catch (error) {
        console.error("🚨 Error during check-in:", error);
        res.status(500).json({ message: "Server error during check-in" });
        return;
    }
});
exports.scanQRCode = scanQRCode;
const generateAnalytics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Count total events
        const totalEvents = yield eventmodel_1.Event.countDocuments();
        // Count total guests across all events
        const totalGuests = yield guestmodel_1.Guest.countDocuments();
        // Count checked-in guests across all events
        const checkedInGuests = yield guestmodel_1.Guest.countDocuments({ checkedIn: true });
        // Calculate unused codes
        const unusedCodes = totalGuests - checkedInGuests;
        res.status(200).json({
            totalEvents,
            totalGuests,
            checkedInGuests,
            unusedCodes,
        });
    }
    catch (error) {
        console.error("Error generating analytics:", error);
        res.status(500).json({ message: "Error generating analytics" });
    }
});
exports.generateAnalytics = generateAnalytics;
const generateTempLink = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        // Check if the event exists
        const event = yield eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        // Generate a JWT with event-specific data and expiration (e.g., 12 hours)
        const token = jsonwebtoken_1.default.sign({ eventId: eventId, role: "temp", type: "checkin" }, process.env.JWT_SECRET, { expiresIn: "72h" });
        // Create a temporary link with the token
        const tempLink = `${process.env.FRONTEND_URL}/blog?token=${token}`;
        res.status(200).json({ tempLink });
    }
    catch (error) {
        console.error("Error generating temp link:", error);
        res.status(500).json({ message: "Error generating temp link" });
    }
});
exports.generateTempLink = generateTempLink;
