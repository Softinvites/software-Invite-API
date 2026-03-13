import { Router } from "express";
import {
  getRsvpFormByToken,
  submitRsvpForm,
  respondFromEmail,
  downloadRsvpCalendarInvite,
  getRsvpPreferences,
  updateRsvpPreferences,
} from "../controllers/rsvpController";
import {
  deleteRsvpGuest,
  updateRsvpGuest,
  updateRsvpStatus,
} from "../controllers/rsvpAdminController";
import auth from "../library/middlewares/auth";

const router = Router();

router.get("/form/:token", getRsvpFormByToken);
router.post("/form/:token/submit", submitRsvpForm);
router.get("/respond/:rsvpId", respondFromEmail);
router.get("/:rsvpId/calendar", downloadRsvpCalendarInvite);
router.get("/preferences/:token", getRsvpPreferences);
router.post("/preferences/:token", updateRsvpPreferences);
router.put("/:rsvpId", auth, updateRsvpGuest);
router.put("/:rsvpId/status", auth, updateRsvpStatus);
router.delete("/:rsvpId", auth, deleteRsvpGuest);

export default router;
