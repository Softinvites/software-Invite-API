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
} from "../controllers/guestController";
import auth from "../library/middlewares/auth";
import { uploadCSVExcel } from "../library/helpers/uploadImage";

const router = express.Router();

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

router.get("/events-guest/:eventId", auth, getGuestsByEvent);
router.get("/single-guest/:id", auth, getGuestById);
router.delete("/single-guest/:id", auth, deleteGuestById);
router.delete("/event-guest/:eventId", auth, deleteGuestsByEvent);
router.post("/scan-qrcode", auth, scanQRCode);
router.get("/get-analytics/:eventId", auth, generateAnalytics);

export default router;
