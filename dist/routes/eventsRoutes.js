"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const eventsController_1 = require("../controllers/eventsController");
const auth_1 = __importDefault(require("../library/middlewares/auth"));
const router = express_1.default.Router();
router.post("/create", auth_1.default, eventsController_1.createEvent);
router.put("/update/:id", auth_1.default, eventsController_1.updateEvent);
router.get("/events", auth_1.default, eventsController_1.getAllEvents);
router.get("/events/:id", auth_1.default, eventsController_1.getEventById);
router.delete("/events", auth_1.default, eventsController_1.deleteAllEvents);
router.delete("/events/:id", auth_1.default, eventsController_1.deleteSingleEvent);
exports.default = router;
