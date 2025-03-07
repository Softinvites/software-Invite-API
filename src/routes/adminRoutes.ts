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

router.post("/admin_register", registerAdmin);
router.post("/admin_login", loginAdmin);
router.get("/admin_profile/:id", auth, getAdminProfile);
router.get("/all_admin_profile", auth, getAllAdminProfile);
router.put("/update_profile/:id", auth, updateAdminProfile);
router.put("/update_admin_password", auth, updateAdminPassword);
router.delete("/all_admin_profile", auth, deleteAdmin);


export default router;
