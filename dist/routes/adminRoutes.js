"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const adminController_1 = require("../controllers/adminController");
const auth_1 = __importDefault(require("../library/middlewares/auth"));
const router = express_1.default.Router();
router.post("/register", adminController_1.registerAdmin);
router.post("/login", adminController_1.loginAdmin);
router.get("/profile/:id", auth_1.default, adminController_1.getAdminProfile);
router.get("/profile", auth_1.default, adminController_1.getAllAdminProfile);
router.put("/update_profile/:id", auth_1.default, adminController_1.updateAdminProfile);
router.put("/update_password/:id", auth_1.default, adminController_1.updateAdminPassword);
router.delete("/delete/:id", auth_1.default, adminController_1.deleteAdmin);
exports.default = router;
