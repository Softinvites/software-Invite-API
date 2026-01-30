import { Router } from "express";
import {
  getRsvpFormByToken,
  submitRsvpForm,
  respondFromEmail,
} from "../controllers/rsvpController";
import { deleteRsvpGuest, updateRsvpStatus } from "../controllers/rsvpAdminController";
import auth from "../library/middlewares/auth";

const router = Router();

router.get("/form/:token", getRsvpFormByToken);
router.post("/form/:token/submit", submitRsvpForm);
router.get("/respond/:rsvpId", respondFromEmail);
router.put("/:rsvpId/status", auth, updateRsvpStatus);
router.delete("/:rsvpId", auth, deleteRsvpGuest);

export default router;
