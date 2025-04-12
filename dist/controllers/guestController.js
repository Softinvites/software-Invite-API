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
const node_fetch_1 = __importDefault(require("node-fetch"));
const emailService_1 = require("../library/helpers/emailService");
const colorUtils_1 = require("../utils/colorUtils");
const sharp_1 = __importDefault(require("sharp"));
const stream_1 = require("stream");
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
        // Create guest without qrCode and qrCodeData
        const newGuest = new guestmodel_1.Guest(Object.assign(Object.assign({ firstName,
            lastName,
            qrCodeBgColor,
            qrCodeCenterColor,
            qrCodeEdgeColor,
            eventId }, (phone && { phone })), (email && { email })));
        const savedGuest = yield newGuest.save(); // Save so we can use the ID
        // Generate QR code data
        const guestId = savedGuest._id.toString();
        const qrCodeData = guestId;
        // Generate QR code
        const qr = new qrcode_svg_1.default({
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
        svg = svg.replace(/<svg([^>]*)>/, `<svg$1>
    <defs>
      <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
      </radialGradient>
    </defs>`);
        // Adjust the QR code style
        svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
            const isBoundingRect = /x="0".*y="0"/.test(group1);
            return isBoundingRect
                ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
                : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        });
        // Convert to PNG
        const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg))
            .resize(512, 512, { fit: "contain" })
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer();
        // Upload to Cloudinary
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
        // Update the saved guest with qrCode and qrCodeData
        savedGuest.qrCode = qrCodeUrl;
        savedGuest.qrCodeData = qrCodeData;
        // Save the guest with QR code data
        yield savedGuest.save();
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
                yield (0, emailService_1.sendEmail)(email, `Your Invitation to ${eventName}`, emailContent);
                console.log("Email sent successfully!");
            }
            catch (emailError) {
                console.error("Error sending email:", emailError);
            }
        }
        res.status(201).json({ message: "Guest created successfully", guest: savedGuest });
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
            // Create guest without qrCode and qrCodeData
            const newGuest = new guestmodel_1.Guest(Object.assign(Object.assign({ firstName,
                lastName,
                qrCodeBgColor,
                qrCodeCenterColor,
                qrCodeEdgeColor,
                eventId }, (phone && { phone })), (email && { email })));
            const savedGuest = yield newGuest.save(); // Save to get guestId
            // Generate QR code data with guestId
            const guestId = savedGuest._id.toString();
            const qrCodeData = guestId;
            // Generate QR code
            const qr = new qrcode_svg_1.default({
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
            svg = svg.replace(/<svg([^>]*)>/, `<svg$1>
          <defs>
            <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <stop offset="0%" stop-color="${centerColorHex}" stop-opacity="1"/>
              <stop offset="100%" stop-color="${edgeColorHex}" stop-opacity="1"/>
            </radialGradient>
          </defs>`);
            // Adjust the QR code style
            svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
                const isBoundingRect = /x="0".*y="0"/.test(group1);
                return isBoundingRect
                    ? `<rect${group1}style="fill:${bgColorHex};${group2}"/>`
                    : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
            });
            // Convert to PNG
            const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg))
                .resize(512, 512, { fit: "contain" })
                .png({ compressionLevel: 9, adaptiveFiltering: true })
                .toBuffer();
            // Upload to Cloudinary
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
            // Update the saved guest with qrCode and qrCodeData
            savedGuest.qrCode = qrCodeUrl;
            savedGuest.qrCodeData = qrCodeData;
            // Save the guest with QR code data
            yield savedGuest.save();
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
                    yield (0, emailService_1.sendEmail)(email, `Your Invitation to ${eventName}`, emailContent);
                    console.log("Email sent successfully!");
                }
                catch (emailError) {
                    console.error("Error sending email:", emailError);
                }
            }
            return { email, success: true };
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
        const { email, firstName, lastName, eventId, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor } = req.body;
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
        // Update guest details
        guest.firstName = firstName || guest.firstName;
        guest.lastName = lastName || guest.lastName;
        guest.email = email || guest.email;
        guest.eventId = eventId || guest.eventId;
        guest.qrCodeBgColor = qrCodeBgColor || guest.qrCodeBgColor;
        guest.qrCodeCenterColor = qrCodeCenterColor || guest.qrCodeCenterColor;
        guest.qrCodeEdgeColor = qrCodeEdgeColor || guest.qrCodeEdgeColor;
        const updatedGuest = yield guest.save();
        // Generate QR code data using guestId
        const guestId = updatedGuest._id.toString();
        const qrCodeData = guestId;
        // Generate QR code
        const qr = new qrcode_svg_1.default({
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
        svg = svg.replace(/<svg([^>]*)>/, `<svg$1>
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" stop-color="${qrCodeCenterColor}" stop-opacity="1"/>
            <stop offset="100%" stop-color="${qrCodeEdgeColor}" stop-opacity="1"/>
          </radialGradient>
        </defs>`);
        // Adjust the QR code style
        svg = svg.replace(/<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g, (match, group1, group2) => {
            const isBoundingRect = /x="0".*y="0"/.test(group1);
            return isBoundingRect
                ? `<rect${group1}style="fill:${qrCodeBgColor};${group2}"/>`
                : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
        });
        const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg))
            .resize(512, 512, { fit: 'contain' })
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer();
        // Upload PNG to Cloudinary
        const uploadResponse = yield uploadImage_1.cloudinary.uploader.upload_stream({
            folder: "qr_codes",
            public_id: `${firstName}_${lastName}_qr`,
            overwrite: true,
            format: "png",
        }, (error, result) => __awaiter(void 0, void 0, void 0, function* () {
            if (error) {
                console.error("Cloudinary Upload Error:", error);
                res.status(500).json({ message: "Error uploading QR code", error });
                return;
            }
            const qrCodeUrl = result === null || result === void 0 ? void 0 : result.secure_url;
            // Update guest with new QR Code URL
            updatedGuest.qrCode = qrCodeUrl !== null && qrCodeUrl !== void 0 ? qrCodeUrl : updatedGuest.qrCode;
            const guestEmail = updatedGuest.email;
            try {
                yield updatedGuest.save();
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
                    yield (0, emailService_1.sendEmail)(guestEmail, `Your Updated QR Code`, emailContent);
                }
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
            res.status(404).json({ message: 'Guest not found' });
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
        const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg))
            .resize(512, 512, { fit: 'contain' })
            .png({ compressionLevel: 9, adaptiveFiltering: true })
            .toBuffer();
        res.setHeader('Content-Disposition', `attachment; filename="qr-${guest.firstName}-${guest.lastName}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(pngBuffer);
    }
    catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Error downloading QR code' });
    }
});
exports.downloadQRCode = downloadQRCode;
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
const downloadAllQRCodes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        const guests = yield guestmodel_1.Guest.find({ eventId });
        if (guests.length === 0) {
            res.status(404).json({ message: 'No guests found' });
            return;
        }
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
        const zipBufferStream = new stream_1.PassThrough();
        archive.pipe(zipBufferStream);
        for (const guest of guests) {
            if (!guest.qrCode) {
                console.warn(`No QR code found for guest ${guest._id}`);
                continue;
            }
            try {
                // Get the original Cloudinary URL with transformations to ensure consistent format
                const cloudinaryUrl = guest.qrCode;
                // Add quality and format parameters to ensure consistent downloads
                const downloadUrl = cloudinaryUrl.replace(/upload\/(.*)\/qr_codes/, 'upload/q_auto,f_auto/qr_codes');
                const response = yield (0, node_fetch_1.default)(downloadUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch QR code: ${response.statusText}`);
                }
                const qrCodeBuffer = yield response.buffer();
                archive.append(qrCodeBuffer, {
                    name: `${guest.firstName}-${guest.lastName}.png`,
                });
            }
            catch (error) {
                console.error(`Error fetching QR code for guest ${guest._id}:`, error);
                // Fallback to generating the QR code if download fails
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
                const pngBuffer = yield (0, sharp_1.default)(Buffer.from(svg))
                    .resize(512, 512, { fit: 'contain' })
                    .png({ compressionLevel: 9, adaptiveFiltering: true })
                    .toBuffer();
                archive.append(pngBuffer, {
                    name: `${guest.firstName}-${guest.lastName}.png`,
                });
            }
        }
        yield archive.finalize();
        const uploadPromise = new Promise((resolve, reject) => {
            const uploadStream = uploadImage_1.cloudinary.uploader.upload_stream({ resource_type: 'raw', folder: 'qrcodes', format: 'zip' }, (error, result) => {
                if (error) {
                    console.error('Cloudinary upload error:', error);
                    reject(error);
                }
                else if (result && result.secure_url) {
                    resolve(result.secure_url);
                }
                else {
                    reject(new Error('Invalid Cloudinary response'));
                }
            });
            zipBufferStream.pipe(uploadStream);
        });
        const zipDownloadLink = yield uploadPromise;
        res.status(200).json({ zipDownloadLink });
    }
    catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Error generating ZIP file' });
    }
});
exports.downloadAllQRCodes = downloadAllQRCodes;
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
const scanQRCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const guest = yield guestmodel_1.Guest.findById(guestId);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Get the event details related to the guest's eventId
        const event = yield eventmodel_1.Event.findById(guest.eventId);
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
        const updatedGuest = yield guest.save();
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
    }
    catch (error) {
        console.error("🚨 Error during check-in:", error);
        res.status(500).json({ message: "Server error during check-in" });
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
