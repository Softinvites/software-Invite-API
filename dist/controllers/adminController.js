"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAdmin = exports.updateAdminPassword = exports.updateAdminProfile = exports.getAllAdminProfile = exports.getAdminProfile = exports.loginAdmin = exports.registerAdmin = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const adminmodel_1 = require("../models/adminmodel");
const mongoose_1 = __importDefault(require("mongoose"));
const utils_1 = require("../utils/utils");
dotenv_1.default.config();
const jwtsecret = process.env.JWT_SECRET;
const registerAdmin = async (req, res) => {
    try {
        const { username, email, password, confirm_password, name } = req.body;
        const validateAdnin = utils_1.RegisterAdminSchema.validate(req.body, utils_1.option);
        if (validateAdnin.error) {
            res.status(400).json({ Error: validateAdnin.error.details[0].message });
            return;
        }
        const existingAdmin = await adminmodel_1.Admin.findOne({ email });
        if (existingAdmin) {
            res.status(400).json({ message: "Admin already exists" });
            return;
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, await bcryptjs_1.default.genSalt(12));
        const newAdmin = new adminmodel_1.Admin({
            username,
            email,
            password: hashedPassword,
            name,
        });
        await newAdmin.save();
        res
            .status(201)
            .json({ message: "Admin registered successfully", data: newAdmin });
        return;
    }
    catch (error) {
        res.status(500).json({ message: "Error registering admin" });
        return;
        console.log(error);
    }
};
exports.registerAdmin = registerAdmin;
const loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const validateAmin = utils_1.LoginAdminSchema.validate(req.body, utils_1.option);
        if (validateAmin.error) {
            res.status(400).json({ Error: validateAmin.error.details[0].message });
            return;
        }
        const admin = await adminmodel_1.Admin.findOne({ email });
        if (!admin) {
            res
                .status(400)
                .json({ message: "Invalid email or password, or user not found" });
            return;
        }
        const isPasswordValid = await bcryptjs_1.default.compare(password, admin.password);
        if (!isPasswordValid) {
            res.status(400).json({ message: "Invalid email or password" });
            return;
        }
        const { _id } = admin;
        //generate token
        const token = jsonwebtoken_1.default.sign({ _id }, jwtsecret, { expiresIn: "1h" });
        res.status(200).json({ message: "Login successful", admin, token });
        return;
    }
    catch (error) {
        console.error("Something went wrong logging in:", error);
        res.status(500).json({ message: "Error logging in admin" });
        return;
    }
};
exports.loginAdmin = loginAdmin;
const getAdminProfile = async (req, res) => {
    try {
        const { id } = req.params;
        const admin = await adminmodel_1.Admin.findById(id);
        if (!admin) {
            res.status(404).json({ message: "Admin not found" });
        }
        res.status(200).json({ message: "Admin successfully fetched", admin });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching admin profile" });
    }
};
exports.getAdminProfile = getAdminProfile;
const getAllAdminProfile = async (req, res) => {
    try {
        const admins = await adminmodel_1.Admin.find({});
        res.status(200).json({ msg: "All Admins successfully fetched", admins });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching admins", error: error });
    }
};
exports.getAllAdminProfile = getAllAdminProfile;
const updateAdminProfile = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, username } = req.body;
        const validateAmin = utils_1.updateAdminProfileSchema.validate(req.body, utils_1.option);
        if (validateAmin.error) {
            res.status(400).json({ Error: validateAmin.error.details[0].message });
        }
        const admin = await adminmodel_1.Admin.findById(id);
        console.log("Admin fetched:", admin);
        if (!admin) {
            res.status(400).json({
                error: "Admin not found",
            });
            return;
        }
        const updatedAdmin = await adminmodel_1.Admin.findByIdAndUpdate(id, { name, username }, {
            new: true,
            runValidators: true,
            context: "query",
        });
        res
            .status(200)
            .json({ message: "Profile updated successfully", admin: updatedAdmin });
    }
    catch (error) {
        console.error("Error updating Admin Profile", error);
        res.status(500).json({ message: "Error updating profile" });
    }
};
exports.updateAdminProfile = updateAdminProfile;
const updateAdminPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { old_password, new_password, confirm_password } = req.body;
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            res.status(400).json({ error: "Invalid ID format" });
            return;
        }
        // Validate request body
        const validateAmin = utils_1.UpdatePasswordSchema.validate(req.body, utils_1.option);
        if (validateAmin.error) {
            res.status(400).json({ Error: validateAmin.error.details[0].message });
            return; // Stop execution
        }
        // Fetch admin
        const admin = await adminmodel_1.Admin.findById(id);
        if (!admin) {
            res.status(404).json({ error: "Admin not found" });
            return;
        }
        // Compare old password
        const isMatch = await bcryptjs_1.default.compare(old_password, admin.password);
        if (!isMatch) {
            res.status(400).json({ error: "Old password is incorrect" });
            return;
        }
        // Hash new password
        const hashedPassword = await bcryptjs_1.default.hash(new_password, 12);
        // Update password
        admin.password = hashedPassword;
        await admin.save();
        res.status(200).json({ message: "Admin password updated successfully" });
    }
    catch (error) {
        console.error("Password update error:", error);
        res.status(500).json({ message: "Error updating password" });
    }
};
exports.updateAdminPassword = updateAdminPassword;
const deleteAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        await adminmodel_1.Admin.findByIdAndDelete(id);
        res.status(200).json({ message: "Admin deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting admin" });
    }
};
exports.deleteAdmin = deleteAdmin;
