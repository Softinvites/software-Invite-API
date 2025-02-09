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

const router = express.Router();

router.post("/create-events", auth, addGuest);

export default router;
