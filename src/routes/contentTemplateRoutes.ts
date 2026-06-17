import express from "express";
import {
  createContentTemplate,
  updateContentTemplate,
  submitForApproval,
  refreshApprovalStatus,
  listContentTemplates,
  getContentTemplate,
  deleteContentTemplate,
  inspectTwilioContent,
} from "../controllers/whatsappContentTemplateController.js";
import auth from "../library/middlewares/auth";

const router = express.Router();

router.get("/", auth, listContentTemplates);
router.post("/", auth, createContentTemplate);
router.get("/:id", auth, getContentTemplate);
router.put("/:id", auth, updateContentTemplate);
router.delete("/:id", auth, deleteContentTemplate);
router.post("/:id/submit", auth, submitForApproval);
router.post("/:id/refresh-status", auth, refreshApprovalStatus);
router.get("/:id/inspect", auth, inspectTwilioContent);

export default router;