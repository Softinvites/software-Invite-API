import { Router } from "express";
import auth from "../library/middlewares/auth";
import { downloadReport } from "../controllers/rsvpReportController";

const router = Router();

router.get("/:reportId/download", auth, downloadReport);

export default router;
