import { Router } from "express";
import { trackEmailOpen, trackEmailClick } from "../controllers/emailTrackingController";

const router = Router();

router.get("/track/open/:trackingId.png", trackEmailOpen);
router.get("/track/click/:trackingId", trackEmailClick);

export default router;
