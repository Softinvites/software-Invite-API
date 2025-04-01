import express from "express";
import {
  addGuest,
  updateGuest,
  importGuests,
  downloadQRCode,
  downloadAllQRCodes,
  getGuestsByEvent,
  getGuestById,
  deleteGuestById,
  deleteGuestsByEvent,
  scanQRCode,
  generateAnalytics,
  generateTempLink
} from "../controllers/guestController";
import auth from "../library/middlewares/auth";
import { combinedAuth } from "../library/middlewares/combinedAuth";
import { uploadCSVExcel } from "../library/helpers/uploadImage";

const router = express.Router();

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

// routhers others can access temporarily
router.post("/scan-qrcode", combinedAuth, scanQRCode);
router.get("/events-guest/:eventId", combinedAuth, getGuestsByEvent);

router.get("/events-guest/:eventId", auth, getGuestsByEvent);
router.get("/events-guest/:eventId", auth, getGuestsByEvent);
router.get("/single-guest/:id", auth, getGuestById);
router.delete("/single-guest/:id", auth, deleteGuestById);
router.delete("/event-guest/:eventId", auth, deleteGuestsByEvent);
router.get("/get-analytics/", auth, generateAnalytics);
router.post("/generate-temp-link/:eventId", auth, generateTempLink);




export default router;
