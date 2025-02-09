"use strict";
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
const guestModel_1 = require("../models/guestModel");
const qrcode_1 = __importDefault(require("qrcode"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const archiver_1 = __importDefault(require("archiver"));
const csv_parser_1 = __importDefault(require("csv-parser"));
const multer_1 = __importDefault(require("multer"));
const utils_1 = require("../utils/utils");
// Configure multer for file uploads
const upload = (0, multer_1.default)({ dest: "uploads/" });
// **Add a Guest & Generate QR Code**
const addGuest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { firstName, lastName, email, phone, eventId } = req.body;
        const validateGuest = utils_1.createGuestSchema.validate(req.body, utils_1.option);
        if (validateGuest.error) {
            res.status(400).json({ Error: validateGuest.error.details[0].message });
        }
        // Generate a unique QR code
        const qrCodeData = `${firstName}-${lastName}-${eventId}`;
        const qrCode = yield qrcode_1.default.toDataURL(qrCodeData);
        const newGuest = new guestModel_1.Guest({
            firstName,
            lastName,
            email,
            phone,
            qrCode,
            event: eventId,
        });
        yield newGuest.save();
        res
            .status(201)
            .json({ message: "Guest added successfully", guest: newGuest });
    }
    catch (error) {
        res.status(500).json({ message: "Error adding guest" });
    }
});
exports.addGuest = addGuest;
// **Update Guest **
const updateGuest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { guestId } = req.params;
        const { firstName, lastName, email, phone, eventId, regenerateQr } = req.body;
        // Validate input
        const validateGuest = utils_1.updateGuestSchema.validate(req.body);
        if (validateGuest.error) {
            res.status(400).json({ error: validateGuest.error.details[0].message });
        }
        // Find the guest by ID
        const guest = yield guestModel_1.Guest.findById(guestId);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        // Update guest fields
        guest.firstName = firstName || guest.firstName;
        guest.lastName = lastName || guest.lastName;
        guest.email = email || guest.email;
        guest.phone = phone || guest.phone;
        guest.event = eventId || guest.event;
        // Regenerate QR code if requested
        if (regenerateQr) {
            const qrCodeData = `${guest.firstName}-${guest.lastName}-${guest.event}`;
            guest.qrCode = yield qrcode_1.default.toDataURL(qrCodeData);
        }
        yield guest.save();
        res.status(200).json({ message: "Guest updated successfully", guest });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating guest" });
    }
});
exports.updateGuest = updateGuest;
// **Import Guests from CSV**
const importGuests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            res.status(400).json({ message: "No file uploaded" });
            return;
        }
        const guests = [];
        const filePath = req.file.path;
        fs_1.default.createReadStream(filePath)
            .pipe((0, csv_parser_1.default)())
            .on("data", (row) => guests.push(row))
            .on("end", () => __awaiter(void 0, void 0, void 0, function* () {
            try {
                for (const guest of guests) {
                    const qrCodeData = `${guest.firstName}-${guest.lastName}-${guest.eventId}`;
                    const qrCode = yield qrcode_1.default.toDataURL(qrCodeData);
                    const newGuest = new guestModel_1.Guest({
                        firstName: guest.firstName,
                        lastName: guest.lastName,
                        email: guest.email,
                        phone: guest.phone,
                        qrCode,
                        event: guest.eventId,
                    });
                    yield newGuest.save();
                }
                fs_1.default.unlink(filePath, (err) => {
                    if (err)
                        console.error("Error deleting CSV file:", err);
                });
                res.status(201).json({ message: "Guests imported successfully" });
            }
            catch (saveError) {
                console.error("Error saving guests:", saveError);
                res.status(500).json({ message: "Error processing guests" });
            }
        }))
            .on("error", (parseError) => {
            console.error("CSV parsing error:", parseError);
            res.status(500).json({ message: "Error parsing CSV file" });
        });
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error importing guests" });
    }
});
exports.importGuests = importGuests;
// **Download QR Codes as PNG (Single)**
const downloadQRCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { guestId } = req.params;
        const guest = yield guestModel_1.Guest.findById(guestId);
        if (!guest) {
            res.status(404).json({ message: "Guest not found" });
            return;
        }
        const qrPath = path_1.default.join(__dirname, `../../qrcodes/${guest.firstName}-${guest.lastName}.png`);
        yield qrcode_1.default.toFile(qrPath, guest.qrCode);
        res.download(qrPath, `${guest.firstName}-${guest.lastName}.png`, (err) => {
            if (err) {
                console.error("Download error:", err);
                return res.status(500).json({ message: "Error downloading QR code" });
            }
            fs_1.default.unlink(qrPath, (unlinkErr) => {
                if (unlinkErr)
                    console.error("Error deleting file:", unlinkErr);
            });
        });
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error downloading QR code" });
    }
});
exports.downloadQRCode = downloadQRCode;
// **Download QR Codes as ZIP**
const downloadAllQRCodes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const guests = yield guestModel_1.Guest.find({});
        if (!guests.length) {
            res.status(404).json({ message: "No guests found" });
            return;
        }
        const zipPath = path_1.default.join(__dirname, "../../qrcodes.zip");
        const output = fs_1.default.createWriteStream(zipPath);
        const archive = (0, archiver_1.default)("zip");
        archive.pipe(output);
        const qrPaths = [];
        for (const guest of guests) {
            const qrPath = path_1.default.join(__dirname, `../../qrcodes/${guest.firstName}-${guest.lastName}.png`);
            yield qrcode_1.default.toFile(qrPath, guest.qrCode);
            archive.file(qrPath, {
                name: `${guest.firstName}-${guest.lastName}.png`,
            });
            qrPaths.push(qrPath);
        }
        yield archive.finalize();
        res.download(zipPath, "qrcodes.zip", (err) => {
            if (err) {
                console.error("Download error:", err);
                return res.status(500).json({ message: "Error downloading QR codes" });
            }
            // Clean up QR files and ZIP
            qrPaths.forEach((qr) => fs_1.default.unlink(qr, (err) => err && console.error("Error deleting QR file:", err)));
            fs_1.default.unlink(zipPath, (err) => err && console.error("Error deleting ZIP file:", err));
        });
    }
    catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Error downloading QR codes" });
    }
});
exports.downloadAllQRCodes = downloadAllQRCodes;
// **Get All Guests for an Event**
const getGuestsByEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params;
        const guests = yield guestModel_1.Guest.find({ event: eventId });
        res.status(200).json({ guests });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching guests" });
    }
});
exports.getGuestsByEvent = getGuestsByEvent;
// **Get Single Guest for an Event**
const getGuestById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { guestId } = req.params; // Extract guestId from the route parameters
        const guest = yield guestModel_1.Guest.findById(guestId); // Find the guest by their ID
        if (!guest) {
            res.status(404).json({ message: "Guest not found" }); // Handle if no guest is found
        }
        res.status(200).json({ guest }); // return the guest data if found
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching guest" }); // Handle any errors
    }
});
exports.getGuestById = getGuestById;
// **Delete Single Guest by ID**
const deleteGuestById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { guestId } = req.params; // Extract guestId from the route parameters
        const guest = yield guestModel_1.Guest.findByIdAndDelete(guestId); // Delete the guest by their ID
        if (!guest) {
            res.status(404).json({ message: "Guest not found" }); // Handle case if no guest is found
        }
        res.status(200).json({ message: "Guest deleted successfully" }); // Respond with success message
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting guest" }); // Handle any errors
    }
});
exports.deleteGuestById = deleteGuestById;
// **Delete Guests by Event ID**
const deleteGuestsByEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { eventId } = req.params; // Extract eventId from route parameters
        const result = yield guestModel_1.Guest.deleteMany({ event: eventId }); // Delete all guests associated with the event
        if (result.deletedCount === 0) {
            res.status(404).json({ message: "No guests found for this event" }); // Handle if no guests were deleted
        }
        res.status(200).json({ message: "Guests deleted successfully" }); // Respond with success message
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting guests" }); // Handle any errors
    }
});
exports.deleteGuestsByEvent = deleteGuestsByEvent;
// **Scan QR Code for Check-in**
const scanQRCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { qrData } = req.body;
        const guest = yield guestModel_1.Guest.findOne({ qrCode: qrData });
        if (!guest) {
            res.status(404).json({ message: "Invalid QR Code" });
            return;
        }
        guest.checkedIn = true;
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
        const { eventId } = req.params;
        const totalGuests = yield guestModel_1.Guest.countDocuments({ event: eventId });
        const checkedInGuests = yield guestModel_1.Guest.countDocuments({
            event: eventId,
            checkedIn: true,
        });
        const unusedCodes = totalGuests - checkedInGuests;
        res.status(200).json({
            eventId,
            totalGuests,
            checkedInGuests,
            unusedCodes,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Error generating analytics" });
    }
});
exports.generateAnalytics = generateAnalytics;
