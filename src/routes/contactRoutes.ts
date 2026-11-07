import { Router } from "express";
import rateLimit from "express-rate-limit";
import auth from "../library/middlewares/auth";
import {
  submitContactMessage,
  listContactMessages,
  getContactMessage,
  updateContactMessage,
  replyToContactMessage,
  deleteContactMessage,
  exportContactMessages,
} from "../controllers/contactController";

const router = Router();

/**
 * The submit endpoint is public and unauthenticated, so it is rate limited by
 * IP. Behind API Gateway / Vercel the client IP arrives in x-forwarded-for,
 * which express-rate-limit reads once `trust proxy` is set (see index.ts).
 */
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many enquiries from this address. Please try again shortly.",
  },
});

// Public — the marketing website posts here.
router.post("/", submitLimiter, submitContactMessage);

// Admin — read in the Softinvites dashboard.
router.get("/", auth, listContactMessages);
router.get("/export", auth, exportContactMessages);
router.get("/:id", auth, getContactMessage);
// PUT and PATCH both accepted. API Gateway answers CORS preflight before the
// Lambda runs, and PATCH was missing from its allowedMethods — so PUT is the
// method that works even on a gateway config that hasn't been redeployed yet.
router.put("/:id", auth, updateContactMessage);
router.patch("/:id", auth, updateContactMessage);
router.post("/:id/reply", auth, replyToContactMessage);
router.delete("/:id", auth, deleteContactMessage);

export default router;
