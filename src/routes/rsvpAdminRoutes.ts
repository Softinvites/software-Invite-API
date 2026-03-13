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
import {
  generateRsvpReport,
  listRsvpReports,
  getShareableReport,
} from "../controllers/rsvpReportController";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "../controllers/rsvpScheduleController";
import {
  runSchedulerNow,
  runSchedulerNowWithSecret,
  triggerSchedulerLambdaRun,
} from "../controllers/rsvpSchedulerController";

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
router.post("/:eventId/rsvp/generate-report", auth, generateRsvpReport);
router.get("/:eventId/rsvp/reports", auth, listRsvpReports);
router.get("/:eventId/rsvp/shareable-report/:token", getShareableReport);
router.get("/:eventId/rsvp/schedules", auth, listSchedules);
router.post("/:eventId/rsvp/schedules", auth, createSchedule);
router.patch("/rsvp/schedules/:scheduleId", auth, updateSchedule);
router.delete("/rsvp/schedules/:scheduleId", auth, deleteSchedule);
router.post("/rsvp/scheduler/run", auth, runSchedulerNow);
router.post("/rsvp/scheduler/run-public", runSchedulerNowWithSecret);
router.post("/rsvp/scheduler/trigger", auth, triggerSchedulerLambdaRun);

export default router;
