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
  scanQRCode,
  generateAnalytics,
  generateEventAnalytics,
  generateTempLink,
} from "../controllers/guestController";
import auth from "../library/middlewares/auth";
import { combinedAuth } from "../library/middlewares/combinedAuth";
import multer from "multer";

const router = express.Router();

// Set up multer for memory storage (CSV/Excel upload)
// const uploadCSVExcel = multer({
//   storage: multer.memoryStorage(),
//   fileFilter: (req, file, cb) => {
//     const allowedMimes = [
//       "text/csv",
//       "application/vnd.ms-excel",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//     ];
//     if (allowedMimes.includes(file.mimetype)) {
//       cb(null, true);
//     } else {
//       cb(new Error("Only CSV or Excel files are allowed"));
//     }
//   },
//   limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
// });

const uploadCSVExcel = multer({ storage: multer.memoryStorage() });

// Guest routes
router.post("/add-guest", auth, addGuest);
router.put("/update-guest/:id", auth, updateGuest);
router.post(
  "/import-guest-csv",
  uploadCSVExcel.single("file"),
  auth,
  importGuests
);

router.get("/download-qrcode/:id", auth, downloadQRCode);
router.get("/download-all-qrcode/:eventId", auth, downloadAllQRCodes);
router.get("/batch-qrcode-download/:eventId/timestamp", auth, downloadBatchQRCodes);

// routhers others can access temporarily
router.post("/scan-qrcode", combinedAuth, scanQRCode);
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
router.get("/get-analytics/", auth, generateAnalytics);
router.get("/event-analytics/:eventId", combinedAuth, generateEventAnalytics);
router.post("/generate-temp-link/:eventId", auth, generateTempLink);

export default router;
