import express from "express";
import {
  createEvent,
  updateEvent,
  getAllEvents,
  getEventById,
  deleteAllEvents,
  deleteSingleEvent,
  updateRsvpSettings,
  updateRsvpFormSettings,
} from "../controllers/eventsController";
import {
  getAnalyticsOverview,
  getChannelAnalytics,
  getTimelineAnalytics,
  getAnalyticsExport,
  getEmailAnalytics,
  getWhatsAppAnalytics,
  getSmsAnalytics,
} from "../controllers/analyticsController";
import {
  createEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
  deleteEmailTemplate,
} from "../controllers/emailTemplateController";
import {
  createWhatsAppTemplate,
  listWhatsAppTemplates,
  sendWhatsAppBroadcast,
  optInWhatsApp,
} from "../controllers/whatsappTemplateController";
import auth from "../library/middlewares/auth";
import multer from "multer";

const router = express.Router();

const storage = multer.memoryStorage(); 
const IV_MIME_TYPES = new Set(["image/png"]);
const STEP_ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "application/pdf",
]);
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "iv") {
      if (IV_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PNG is allowed for IV image"));
      }
      return;
    }

    if (file.fieldname.startsWith("sequenceAttachment_")) {
      if (STEP_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Step attachment must be PNG, JPG, or PDF"));
      }
      return;
    }

    cb(new Error("Unsupported file field"));
  }
});

router.post("/create", auth, upload.any(), createEvent);
// router.put("/update/:id", auth, upload.any(), updateEvent);
router.put("/update", auth, upload.any(), updateEvent);
router.post("/update/:id", auth, upload.any(), updateEvent);
router.get("/events", auth, getAllEvents);
router.get("/events/:id", auth, getEventById);
router.put("/events/:id/rsvp-settings", auth, updateRsvpSettings);
router.put("/events/:id/rsvp-form-settings", auth, updateRsvpFormSettings);
router.get("/:eventId/analytics/overview", auth, getAnalyticsOverview);
router.get("/:eventId/analytics/channels", auth, getChannelAnalytics);
router.get("/:eventId/analytics/timeline", auth, getTimelineAnalytics);
router.get("/:eventId/analytics/export", auth, getAnalyticsExport);
router.get("/:eventId/analytics/email", auth, getEmailAnalytics);
router.get("/:eventId/analytics/whatsapp", auth, getWhatsAppAnalytics);
router.get("/:eventId/analytics/sms", auth, getSmsAnalytics);
router.get("/events/:eventId/analytics/overview", auth, getAnalyticsOverview);
router.get("/events/:eventId/analytics/channels", auth, getChannelAnalytics);
router.get("/events/:eventId/analytics/timeline", auth, getTimelineAnalytics);
router.get("/events/:eventId/analytics/export", auth, getAnalyticsExport);
router.get("/events/:eventId/analytics/email", auth, getEmailAnalytics);
router.get("/events/:eventId/analytics/whatsapp", auth, getWhatsAppAnalytics);
router.get("/events/:eventId/analytics/sms", auth, getSmsAnalytics);
router.post("/events/:eventId/email/templates", auth, createEmailTemplate);
router.get("/events/:eventId/email/templates", auth, listEmailTemplates);
router.put("/email/templates/:templateId", auth, updateEmailTemplate);
router.delete("/email/templates/:templateId", auth, deleteEmailTemplate);
router.post("/events/:eventId/whatsapp/templates", auth, createWhatsAppTemplate);
router.get("/events/:eventId/whatsapp/templates", auth, listWhatsAppTemplates);
router.post("/events/:eventId/whatsapp/broadcast", auth, sendWhatsAppBroadcast);
router.post("/events/:eventId/whatsapp/opt-in", optInWhatsApp);
router.delete("/events", auth, deleteAllEvents);
router.delete("/events/:id", auth, deleteSingleEvent);

export default router;
