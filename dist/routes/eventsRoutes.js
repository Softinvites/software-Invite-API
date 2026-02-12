"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const eventsController_1 = require("../controllers/eventsController");
const analyticsController_1 = require("../controllers/analyticsController");
const emailTemplateController_1 = require("../controllers/emailTemplateController");
const whatsappTemplateController_1 = require("../controllers/whatsappTemplateController");
const auth_1 = __importDefault(require("../library/middlewares/auth"));
const multer_1 = __importDefault(require("multer"));
const router = express_1.default.Router();
const storage = multer_1.default.memoryStorage();
const upload = (0, multer_1.default)({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/png')
            cb(null, true);
        else
            cb(new Error('Only PNG images are allowed'));
    }
});
router.post("/create", auth_1.default, upload.single("iv"), eventsController_1.createEvent);
// router.put("/update/:id", auth, upload.single("iv"), updateEvent);
router.put("/update", auth_1.default, upload.single("iv"), eventsController_1.updateEvent);
router.post("/update/:id", auth_1.default, upload.single("iv"), eventsController_1.updateEvent);
router.get("/events", auth_1.default, eventsController_1.getAllEvents);
router.get("/events/:id", auth_1.default, eventsController_1.getEventById);
router.put("/events/:id/rsvp-settings", auth_1.default, eventsController_1.updateRsvpSettings);
router.put("/events/:id/rsvp-form-settings", auth_1.default, eventsController_1.updateRsvpFormSettings);
router.get("/events/:eventId/analytics/overview", auth_1.default, analyticsController_1.getAnalyticsOverview);
router.get("/events/:eventId/analytics/channels", auth_1.default, analyticsController_1.getChannelAnalytics);
router.get("/events/:eventId/analytics/timeline", auth_1.default, analyticsController_1.getTimelineAnalytics);
router.get("/events/:eventId/analytics/export", auth_1.default, analyticsController_1.getAnalyticsExport);
router.get("/events/:eventId/analytics/email", auth_1.default, analyticsController_1.getEmailAnalytics);
router.get("/events/:eventId/analytics/whatsapp", auth_1.default, analyticsController_1.getWhatsAppAnalytics);
router.get("/events/:eventId/analytics/sms", auth_1.default, analyticsController_1.getSmsAnalytics);
router.post("/events/:eventId/email/templates", auth_1.default, emailTemplateController_1.createEmailTemplate);
router.get("/events/:eventId/email/templates", auth_1.default, emailTemplateController_1.listEmailTemplates);
router.put("/email/templates/:templateId", auth_1.default, emailTemplateController_1.updateEmailTemplate);
router.delete("/email/templates/:templateId", auth_1.default, emailTemplateController_1.deleteEmailTemplate);
router.post("/events/:eventId/whatsapp/templates", auth_1.default, whatsappTemplateController_1.createWhatsAppTemplate);
router.get("/events/:eventId/whatsapp/templates", auth_1.default, whatsappTemplateController_1.listWhatsAppTemplates);
router.post("/events/:eventId/whatsapp/broadcast", auth_1.default, whatsappTemplateController_1.sendWhatsAppBroadcast);
router.post("/events/:eventId/whatsapp/opt-in", whatsappTemplateController_1.optInWhatsApp);
router.delete("/events", auth_1.default, eventsController_1.deleteAllEvents);
router.delete("/events/:id", auth_1.default, eventsController_1.deleteSingleEvent);
exports.default = router;
