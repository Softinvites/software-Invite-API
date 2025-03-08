import express from "express";
import {
  registerAdmin,
  loginAdmin,
  getAdminProfile,
  getAllAdminProfile,
  updateAdminProfile,
  updateAdminPassword,
  deleteAdmin,
} from "../controllers/adminController";
import auth from "../library/middlewares/auth";

const router = express.Router();

router.post("/register", registerAdmin);
router.post("/login", loginAdmin);
router.get("/profile/:id", auth, getAdminProfile);
router.get("/profile", auth, getAllAdminProfile);
router.put("/update_profile/:id", auth, updateAdminProfile);
router.put("/update_password/:id", auth, updateAdminPassword);
router.delete("/delete/:id", auth, deleteAdmin);

export default router;
