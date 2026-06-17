import express from "express";
import {
  createEvent,
  createEventAssetUpload,
  updateEvent,
  getAllEvents,
  getEventById,
  deleteAllEvents,
  deleteSingleEvent,
  updateRsvpSettings,
  updateRsvpFormSettings,
  saveEventIvUrl,
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
  getRecommendedWhatsAppTemplateSamples,
  optInWhatsApp,
} from "../controllers/whatsappTemplateController";
import auth from "../library/middlewares/auth";
import multer from "multer";
import {
  EVENT_FIELD_COUNT_LIMIT,
  EVENT_FIELD_SIZE_LIMIT_BYTES,
  EVENT_FILE_COUNT_LIMIT,
  EVENT_PART_COUNT_LIMIT,
} from "../config/requestLimits";

const router = express.Router();

const storage = multer.memoryStorage(); 
const IV_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const STEP_ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const upload = multer({ 
  storage,
  limits: {
    files: EVENT_FILE_COUNT_LIMIT,
    fields: EVENT_FIELD_COUNT_LIMIT,
    fieldSize: EVENT_FIELD_SIZE_LIMIT_BYTES,
    parts: EVENT_PART_COUNT_LIMIT,
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "iv") {
      if (IV_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PNG, JPEG, or WEBP images are allowed for the invitation image"));
      }
      return;
    }

    if (file.fieldname.startsWith("sequenceAttachment_")) {
      if (STEP_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new Error(
            "Step attachment must be image (PNG, JPG, JPEG, WEBP, GIF) or PDF",
          ),
        );
      }
      return;
    }

    cb(new Error("Unsupported file field"));
  }
});

router.post("/assets/presign", auth, createEventAssetUpload);
router.post("/assets/iv-url", auth, saveEventIvUrl);
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
router.get(
  "/events/:eventId/whatsapp/template-samples",
  auth,
  getRecommendedWhatsAppTemplateSamples,
);
router.post("/events/:eventId/whatsapp/broadcast", auth, sendWhatsAppBroadcast);
router.post("/events/:eventId/whatsapp/opt-in", optInWhatsApp);
router.delete("/events", auth, deleteAllEvents);
router.delete("/events/:id", auth, deleteSingleEvent);

export default router;
