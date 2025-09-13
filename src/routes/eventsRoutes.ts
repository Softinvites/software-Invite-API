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
import multer from "multer";

const router = express.Router();

const storage = multer.memoryStorage(); 
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') cb(null, true);
    else cb(new Error('Only PNG images are allowed'));
  }
});

router.post("/create", auth, upload.single("iv"), createEvent);
// router.put("/update/:id", auth, upload.single("iv"), updateEvent);
router.put("/update", auth, upload.single("iv"), updateEvent);
router.post("/update/:id", auth, upload.single("iv"), updateEvent);
router.get("/events", auth, getAllEvents);
router.get("/events/:id", auth, getEventById);
router.delete("/events", auth, deleteAllEvents);
router.delete("/events/:id", auth, deleteSingleEvent);

export default router;
