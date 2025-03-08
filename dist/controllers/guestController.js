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
exports.generateAnalytics = exports.scanQRCode = exports.deleteGuestsByEvent = exports.deleteGuestById = exports.getGuestById = exports.getGuestsByEvent = exports.downloadAllQRCodes = exports.downloadQRCode = exports.importGuests = exports.updateGuest = exports.addGuest = void 0;
const guestmodel_1 = require("../models/guestmodel");
const eventmodel_1 = require("../models/eventmodel");
const qrcode_1 = __importDefault(require("qrcode"));
const archiver_1 = __importDefault(require("archiver"));
const xlsx_1 = __importDefault(require("xlsx"));
const fastcsv = __importStar(require("fast-csv"));
const uploadImage_1 = require("../library/helpers/uploadImage");
const utils_1 = require("../utils/utils");
const stream_1 = __importDefault(require("stream"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const emailService_1 = require("../library/helpers/emailService");
// **Add a Guest & Generate QR Code**
const addGuest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, phone, eventId } = req.body;
        // Validate request body
        const validateGuest = utils_1.createGuestSchema.validate(req.body, utils_1.option);
        if (validateGuest.error) {
            res.status(400).json({ Error: validateGuest.error.details[0].message });
            return;
        }
        // Check if guest already exists for this event
        const existingGuest = yield guestmodel_1.Guest.findOne({ email, eventId });
        if (existingGuest) {
            res.status(409).json({ message: "Guest already exists for this event" });
            return;
        }
        // Retrieve event details using eventId
        const event = yield eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const eventName = event.name; // Get event name
        const eventDate = event.date; // Get event date
        const EventLocation = event.location;
        // Generate a properly formatted QR code data
        const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${EventLocation}`;
        const qrCodeDataUrl = yield qrcode_1.default.toDataURL(qrCodeData);
        // Upload QR code to Cloudinary
        const uploadResponse = yield uploadImage_1.cloudinary.uploader.upload(qrCodeDataUrl, {
            folder: "qr_codes",
            public_id: `${firstName}_${lastName}_qr`,
            overwrite: true,
        });
        // Save guest details with QR code URL
        const newGuest = new guestmodel_1.Guest({
            firstName,
            lastName,
            email,
            phone,
            eventId,
            qrCode: uploadResponse.secure_url, // Save Cloudinary URL in MongoDB
        });
        yield newGuest.save();
        // ✅ Send email using Zoho or Brevo
        const emailContent = `
<h2>Welcome to ${eventName}!</h2>
<p>Dear ${firstName},</p>
<p>We are delighted to invite you to <strong>${eventName}</strong>. </p>

<h3>Event Details:</h3>
<p><strong>Date:</strong> ${eventDate}</p>
<p><strong>Location:</strong> ${event.location}</p>

<p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
<img src="${uploadResponse.secure_url}" alt="QR Code" />

<p>See you at ${eventName}!</p>
`;
        try {
            yield (0, emailService_1.sendEmail)(email, `Your Invitation to ${eventName}`, emailContent);
            console.log("Email sent successfully!");
        }
        catch (error) {
            console.error("Error sending email:", error);
        }
        res
            .status(201)
            .json({ message: "Guest created successfully", guest: newGuest });
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error creating guest", error });
    }
});
exports.addGuest = addGuest;
// **Update Guest **
const updateGuest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { firstName, lastName, email, phone, eventId } = req.body;
        // Validate input
        const validateGuest = utils_1.updateGuestSchema.validate(req.body);
        if (validateGuest.error) {
            res.status(400).json({ error: validateGuest.error.details[0].message });
            return;
        }
        // Find the guest by ID
        const guest = yield guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Extract old QR code public ID from Cloudinary URL
        if (guest.qrCode) {
            const oldPublicId = (_a = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)) === null || _a === void 0 ? void 0 : _a[1]; // Correct extraction
            if (oldPublicId) {
                const deleteResponse = yield uploadImage_1.cloudinary.uploader.destroy(`qr_codes/${oldPublicId}`);
                console.log("Cloudinary delete response:", deleteResponse); // Debugging
            }
        }
        // Update guest fields
        guest.firstName = firstName || guest.firstName;
        guest.lastName = lastName || guest.lastName;
        guest.email = email || guest.email;
        guest.phone = phone || guest.phone;
        guest.eventId = eventId || guest.eventId;
        // Generate a new QR code with updated info
        /// Retrieve event details using eventId
        const event = yield eventmodel_1.Event.findById(eventId);
        if (!event) {
            res.status(404).json({ message: "Event not found" });
            return;
        }
        const eventName = event.name; // Get event name
        const eventDate = event.date; // Get event date
        // Generate a properly formatted QR code data
        const qrCodeData = `First Name: ${firstName}\nLast Name: ${lastName}\nEmail: ${email}\nPhone: ${phone}\nEvent: ${eventName}\nDate: ${eventDate}`;
        const qrCodeDataUrl = yield qrcode_1.default.toDataURL(qrCodeData);
        // Upload new QR code to Cloudinary
        const uploadResponse = yield uploadImage_1.cloudinary.uploader.upload(qrCodeDataUrl, {
            folder: "qr_codes",
            public_id: `${guest.firstName}_${guest.lastName}_qr`,
            overwrite: true, // Ensure old QR code is replaced
        });
        // Save new QR code URL in database
        guest.qrCode = uploadResponse.secure_url;
        // Save updated guest details
        yield guest.save();
        res.status(200).json({ message: "Guest updated successfully", guest });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating guest", error });
    }
});
exports.updateGuest = updateGuest;
// ✅ Process Guests and Save to Database
const processGuests = (guests, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        for (const guest of guests) {
            const { firstName, lastName, email, phone, eventId } = guest;
            // Skip if email is missing
            if (!email)
                continue;
            // Check if guest already exists
            const existingGuest = yield guestmodel_1.Guest.findOne({ email, eventId });
            if (existingGuest)
                continue;
            // Retrieve event details
            const event = yield eventmodel_1.Event.findById(eventId);
            if (!event)
                continue;
            const eventName = event.name;
            const eventDate = event.date;
            const EventLocation = event.location;
            // Generate a properly formatted QR code data
            const qrCodeData = `First Name: ${guest.firstName}\nLast Name: ${guest.lastName}\nEmail: ${guest.email}\nPhone: ${guest.phone}\nEvent: ${eventName}\nDate: ${eventDate}\nLocation: ${EventLocation}`;
            const qrCodeDataUrl = yield qrcode_1.default.toDataURL(qrCodeData);
            // ✅ Upload QR Code to Cloudinary
            const uploadResponse = yield uploadImage_1.cloudinary.uploader.upload(qrCodeDataUrl, {
                folder: "qr_codes",
                public_id: `${guest.firstName}_${guest.lastName}_qr`,
                overwrite: true,
            });
            // ✅ Save Guest to Database
            const newGuest = new guestmodel_1.Guest({
                firstName: guest.firstName,
                lastName: guest.lastName,
                email: guest.email,
                phone: guest.phone,
                qrCode: uploadResponse.secure_url,
                eventId: guest.eventId,
                eventName: eventName, // Storing event name separately
                eventDate: eventDate,
                imported: true, // Set imported to true since the guest is being added from a file
            });
            yield newGuest.save();
            // ✅ Send email using Zoho or Brevo
            const emailContent = `
    <h2>Welcome to ${eventName}!</h2>
    <p>Dear ${firstName},</p>
    <p>We are delighted to invite you to <strong>${eventName}</strong>. </p>
    
    <h3>Event Details:</h3>
    <p><strong>Date:</strong> ${eventDate}</p>
    <p><strong>Location:</strong> ${event.location}</p>
    
    <p>Your QR code for the event is attached below. Please present this QR code upon arrival.</p>
    <img src="${uploadResponse.secure_url}" alt="QR Code" />
    
    <p>See you at ${eventName}!</p>
    `;
            yield (0, emailService_1.sendEmail)(email, `Your Invitation to ${eventName}`, emailContent);
        }
        res.status(201).json({ message: "Guests imported successfully" });
    }
    catch (error) {
        console.error("Error saving guests:", error);
        res.status(500).json({ message: "Error processing guests" });
    }
});
// ✅ Import Guests from CSV/Excel and delete from Cloudinary
const importGuests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        // ✅ Upload CSV/Excel as "raw" file type in Cloudinary
        const uploadResponse = yield uploadImage_1.cloudinary.uploader.upload(req.file.path, {
            resource_type: "raw",
            folder: "uploads",
        });
        const fileUrl = uploadResponse.secure_url; // ✅ Get the file URL
        const publicId = uploadResponse.public_id; // ✅ Get the correct public_id
        const guests = [];
        if (req.file.mimetype === "text/csv") {
            // ✅ Fetch CSV file correctly
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
                    yield uploadImage_1.cloudinary.uploader.destroy(publicId); // ✅ Ensure deletion happens
                }
            }))
                .on("error", (err) => __awaiter(void 0, void 0, void 0, function* () {
                console.error("CSV parsing error:", err);
                yield uploadImage_1.cloudinary.uploader.destroy(publicId); // ✅ Delete file in case of error
                res.status(500).json({ message: "Error parsing CSV file" });
            }));
        }
        else if (req.file.mimetype.includes("spreadsheet")) {
            // ✅ Fetch Excel file correctly
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
                yield uploadImage_1.cloudinary.uploader.destroy(publicId); // ✅ Ensure deletion happens
            }
        }
        else {
            yield uploadImage_1.cloudinary.uploader.destroy(publicId); // ✅ Delete file if invalid type
            res.status(400).json({ message: "Invalid file type" });
        }
    }
    catch (error) {
        console.error("Error importing guests:", error);
        res.status(500).json({ message: "Error importing guests" });
    }
});
exports.importGuests = importGuests;
// Define color mapping for QR code generation
const qrColorMap = {
    black: "#000000",
    blue: "#0000FF",
    red: "#FF0000",
    yellow: "#FFFF00",
    green: "#008000",
};
// **Download QR Code as PNG (Single)**
const downloadQRCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { qrCodeColor } = req.body;
        const guest = yield guestmodel_1.Guest.findById(id);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Determine QR code color (use provided one or fallback to guest's color)
        const color = qrColorMap[qrCodeColor] || qrColorMap[guest.qrCodeColor] || "#000000";
        // Generate QR Code with the selected color
        const qrCodeBuffer = yield qrcode_1.default.toBuffer(guest.qrCode, {
            color: { dark: color, light: "#FFFFFF" }, // Dark is the QR code, Light is the background
        });
        // Upload QR code to Cloudinary
        const uploadResponse = yield new Promise((resolve, reject) => {
            const uploadStream = uploadImage_1.cloudinary.uploader.upload_stream({ resource_type: "image", folder: "qrcodes" }, (error, result) => {
                if (error) {
                    console.error("Cloudinary upload error:", error);
                    reject(error);
                }
                else if (result) {
                    resolve(result.secure_url);
                }
            });
            const readableStream = new stream_1.default.PassThrough();
            readableStream.end(qrCodeBuffer);
            readableStream.pipe(uploadStream);
        });
        // Send Cloudinary URL for download
        res.json({ downloadUrl: uploadResponse });
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error downloading QR code" });
    }
});
exports.downloadQRCode = downloadQRCode;
// **Download All QR Codes as ZIP**
const downloadAllQRCodes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        const { qrCodeColor } = req.body;
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
            // Determine QR code color for each guest
            const color = qrColorMap[qrCodeColor] || qrColorMap[guest.qrCodeColor] || "#000000";
            const qrCodeBuffer = yield qrcode_1.default.toBuffer(guest.qrCode, {
                color: { dark: color, light: "#FFFFFF" },
            });
            archive.append(qrCodeBuffer, {
                name: `${guest.firstName}-${guest.lastName}.png`,
            });
        }
        // Finalize archive
        yield archive.finalize();
        // Upload the ZIP to Cloudinary
        const zipDownloadLink = yield new Promise((resolve, reject) => {
            const uploadStream = uploadImage_1.cloudinary.uploader.upload_stream({ resource_type: "raw", folder: "qrcodes", format: "zip" }, (error, result) => {
                if (error) {
                    console.error("Cloudinary upload error:", error);
                    reject(error);
                }
                else if (result) {
                    resolve(result.secure_url);
                }
            });
            zipBufferStream.pipe(uploadStream);
        });
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
// **Delete Single Guest by ID**
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
        // Delete guest from database
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
    var _a;
    try {
        const { eventId } = req.params;
        // Find all guests associated with the event
        const guests = yield guestmodel_1.Guest.find({ eventId });
        if (guests.length === 0) {
            res.status(404).json({ message: "No guests found for this event" });
            return;
        }
        // Delete all QR codes from Cloudinary
        for (const guest of guests) {
            if (guest.qrCode) {
                const publicId = (_a = guest.qrCode.match(/\/qr_codes\/([^/]+)\./)) === null || _a === void 0 ? void 0 : _a[1];
                if (publicId) {
                    yield uploadImage_1.cloudinary.uploader.destroy(`qr_codes/${publicId}`);
                }
            }
        }
        // Delete all guests from database
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
// **Scan QR Code for Check-in**
const scanQRCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { qrData } = req.body;
        const guest = yield guestmodel_1.Guest.findOne({ qrCode: qrData });
        if (!guest) {
            res.status(404).json({ message: "Invalid QR Code" });
            return;
        }
        if (guest.checkedIn) {
            res.status(400).json({ message: "Guest already checked in" });
            return;
        }
        guest.checkedIn = true;
        guest.status = "checked-in";
        yield guest.save();
        res.status(200).json({ message: "Guest checked in successfully", guest });
    }
    catch (error) {
        res.status(500).json({ message: "Error scanning QR code" });
    }
});
exports.scanQRCode = scanQRCode;
// **Generate Analytics (Used & Unused QR Codes)**
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
