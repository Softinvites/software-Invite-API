"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const guestController_1 = require("../controllers/guestController");
const auth_1 = __importDefault(require("../library/middlewares/auth"));
const combinedAuth_1 = require("../library/middlewares/combinedAuth");
const uploadImage_1 = require("../library/helpers/uploadImage");
const router = express_1.default.Router();
// Guest routes
router.post("/add-guest", auth_1.default, guestController_1.addGuest);
router.put("/update-guest/:id", auth_1.default, guestController_1.updateGuest);
router.post("/import-guest-csv", uploadImage_1.uploadCSVExcel.single("file"), auth_1.default, guestController_1.importGuests);
router.get("/download-qrcode/:id", auth_1.default, guestController_1.downloadQRCode);
router.get("/download-all-qrcode/:eventId", auth_1.default, guestController_1.downloadAllQRCodes);
router.get("/batch-qrcode-download/:eventId/timestamp", auth_1.default, guestController_1.downloadBatchQRCodes);
// routhers others can access temporarily
router.post("/scan-qrcode", combinedAuth_1.combinedAuth, guestController_1.scanQRCode);
router.get("/events-guest/:eventId", combinedAuth_1.combinedAuth, guestController_1.getGuestsByEvent);
router.get("/single-guest/:id", combinedAuth_1.combinedAuth, guestController_1.getGuestById);
//other routes
router.delete("/single-guest/:id", auth_1.default, guestController_1.deleteGuestById);
router.delete("/event-guest/:eventId", auth_1.default, guestController_1.deleteGuestsByEvent);
router.delete("/delete/:eventId/timestamp", auth_1.default, guestController_1.deleteGuestsByEventAndTimestamp);
router.get("/get-analytics/", auth_1.default, guestController_1.generateAnalytics);
router.post("/generate-temp-link/:eventId", auth_1.default, guestController_1.generateTempLink);
exports.default = router;
