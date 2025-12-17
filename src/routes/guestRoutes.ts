import express from "express";
import {
  addGuest,
  updateGuest,
  importGuests,
  downloadQRCode,
  downloadAllQRCodes,
  downloadBatchQRCodes,
  getGuestsByEvent,
  getGuestById,
  deleteGuestById,
  deleteGuestsByEvent,
  deleteGuestsByEventAndTimestamp,
  deleteSelectedGuests,
  scanQRCode,
  generateAnalytics,
  generateEventAnalytics,
  generateTempLink,
  downloadEmailQRCode,
  restoreGuestsAndRegenerateQRCodes,
  testDatabase,
  checkQRCodeStatus,
  checkInGuest,
  resendAllEmails
} from "../controllers/guestController";
import auth from "../library/middlewares/auth";
import { combinedAuth } from "../library/middlewares/combinedAuth";
import multer from "multer";

const router = express.Router();

const uploadCSVExcel = multer({ storage: multer.memoryStorage() });



// Guest routes
router.post("/add-guest", auth, addGuest);
router.put("/update-guest", auth, updateGuest);
router.post(
  "/import-guest-csv",
  uploadCSVExcel.single("file"),
  auth,
  importGuests
);

router.get("/download-qrcode/:id", auth, downloadQRCode);
router.get("/download-emailcode/:id", downloadEmailQRCode);
router.get("/download-all-qrcode/:eventId", auth, downloadAllQRCodes);
router.post("/batch-qrcode-download/:eventId/timestamp", auth, downloadBatchQRCodes);

// routhers others can access temporarily
router.post("/scan-qrcode", combinedAuth, scanQRCode);
router.put("/checkin/:id", combinedAuth, checkInGuest);
router.get("/events-guest/:eventId", combinedAuth, getGuestsByEvent);
router.get("/single-guest/:id", combinedAuth, getGuestById);

//other routes

router.delete("/single-guest/:id", auth, deleteGuestById);
router.delete("/event-guest/:eventId", auth, deleteGuestsByEvent);
router.delete(
  "/delete/:eventId/timestamp",
  auth,
  deleteGuestsByEventAndTimestamp
);
router.delete("/delete-selected", auth, deleteSelectedGuests);
router.get("/get-analytics/", auth, generateAnalytics);
router.get("/event-analytics/:eventId", combinedAuth, generateEventAnalytics);
router.post("/generate-temp-link/:eventId", auth, generateTempLink);

//Restore guests from backup
router.post("/guests-restore", auth, restoreGuestsAndRegenerateQRCodes);
router.get("/test-database/:eventId", auth, testDatabase);
router.get("/check-qrcode-status/:eventId", combinedAuth, checkQRCodeStatus);
router.post("/resend-all-emails/:eventId", auth, resendAllEmails);

export default router;
