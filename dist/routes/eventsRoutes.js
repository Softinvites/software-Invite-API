"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const eventsController_1 = require("../controllers/eventsController");
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
router.delete("/events", auth_1.default, eventsController_1.deleteAllEvents);
router.delete("/events/:id", auth_1.default, eventsController_1.deleteSingleEvent);
exports.default = router;
