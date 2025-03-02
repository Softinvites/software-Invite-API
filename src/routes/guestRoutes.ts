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
import { upload } from "../library/helpers/uploadImage";

const router = express.Router();

router.post("/add-guest", auth, addGuest);
router.put("/update-guest", auth, updateGuest);
router.get("/import-guest-csv", auth, importGuests);
router.get("/download-qrcode", auth, downloadQRCode);
router.get("/download-all-qrcode", auth, downloadAllQRCodes);
router.get("/get-events-guest", auth, getGuestsByEvent);
router.get("/get-single-guest", auth, getGuestById);
router.delete("/delete-single-guest", auth, deleteGuestById);
router.delete("/delete-event-guest", auth, deleteGuestsByEvent);
router.get("/scan-qrcode", auth, scanQRCode);
router.get("/get-analytics", auth, generateAnalytics);

export default router;
