import express from "express";
import {
  createEvent,
  updateEvent,
  getAllEvents,
  getEventById,
  deleteAllEvents,
  deleteSingleEvent,
} from "../controllers/eventsController";
import auth from "../library/middlewares/auth";

const router = express.Router();

router.post("/create-events", auth, createEvent);
router.post("/update-events", auth, updateEvent);
router.get("/events", auth, getAllEvents);
router.get("/event/:id", auth, getEventById);
router.delete("/events", auth, deleteAllEvents);
router.delete("/event/:id", auth, deleteSingleEvent);

export default router;
