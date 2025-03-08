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

router.post("/create", auth, createEvent);
router.put("/update/:id", auth, updateEvent);
router.get("/events", auth, getAllEvents);
router.get("/events/:id", auth, getEventById);
router.delete("/events", auth, deleteAllEvents);
router.delete("/events/:id", auth, deleteSingleEvent);

export default router;
