import { Router } from "express";
import auth from "../library/middlewares/auth";
import multer from "multer";
import {
  exportRsvpCsv,
  getRsvpGuests,
  addRsvpGuest,
  importRsvpGuests,
  sendRsvpInvites,
  generateRsvpFormLink,
} from "../controllers/rsvpAdminController";

const router = Router();
const uploadCSVExcel = multer({ storage: multer.memoryStorage() });

router.get("/:eventId/rsvp/guests", auth, getRsvpGuests);
router.post("/:eventId/rsvp/guests", auth, addRsvpGuest);
router.post(
  "/:eventId/rsvp/import",
  uploadCSVExcel.single("file"),
  auth,
  importRsvpGuests,
);
router.post("/:eventId/rsvp/send", auth, sendRsvpInvites);
router.get("/:eventId/rsvp/export", auth, exportRsvpCsv);
router.post("/:eventId/rsvp/generate-form", auth, generateRsvpFormLink);

export default router;
