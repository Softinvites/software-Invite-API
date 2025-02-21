"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAdmin = exports.updateAdminPassword = exports.updateAdminProfile = exports.getAllAdminProfile = exports.getAdminProfile = exports.loginAdmin = exports.registerAdmin = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const adminmodel_1 = require("../models/adminmodel");
const utils_1 = require("../utils/utils");
dotenv_1.default.config();
const jwtsecret = process.env.JWT_SECRET;
const registerAdmin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Incoming request data:", req.body); // ✅ Debugging
        const { username, email, password, confirm_password, name } = req.body;
        const validateAdnin = utils_1.RegisterAdminSchema.validate(req.body, utils_1.option);
        if (validateAdnin.error) {
            res.status(400).json({ Error: validateAdnin.error.details[0].message });
            return;
        }
        const existingAdmin = yield adminmodel_1.Admin.findOne({ email });
        if (existingAdmin) {
            res.status(400).json({ message: "Admin already exists" });
            return;
        }
        const hashedPassword = yield bcryptjs_1.default.hash(password, yield bcryptjs_1.default.genSalt(12));
        const newAdmin = new adminmodel_1.Admin({
            username,
            email,
            password: hashedPassword,
            name,
        });
        yield newAdmin.save();
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
});
exports.registerAdmin = registerAdmin;
const loginAdmin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password } = req.body;
        const validateAmin = utils_1.LoginAdminSchema.validate(req.body, utils_1.option);
        if (validateAmin.error) {
            res.status(400).json({ Error: validateAmin.error.details[0].message });
            return;
        }
        // const admin = (await Admin.findOne({ email })) as unknown as {
        //   [key: string]: string;
        // };
        const admin = yield adminmodel_1.Admin.findOne({ email });
        if (!admin) {
            res
                .status(400)
                .json({ message: "Invalid email or password, or user not found" });
            return;
        }
        const isPasswordValid = yield bcryptjs_1.default.compare(password, admin.password);
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
});
exports.loginAdmin = loginAdmin;
const getAdminProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const admin = yield adminmodel_1.Admin.findById(id);
        if (!admin) {
            res.status(404).json({ message: "Admin not found" });
        }
        res.status(200).json({ message: "Admin successfully fetched", admin });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching admin profile" });
    }
});
exports.getAdminProfile = getAdminProfile;
const getAllAdminProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const admins = yield adminmodel_1.Admin.find({}).populate("admin");
        res.status(200).json({ msg: "All Admins successfully fetched", admins });
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching admins" });
    }
});
exports.getAllAdminProfile = getAllAdminProfile;
const updateAdminProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, username } = req.body;
        const validateAmin = utils_1.updateAdminProfileSchema.validate(req.body, utils_1.option);
        if (validateAmin.error) {
            res.status(400).json({ Error: validateAmin.error.details[0].message });
        }
        const admin = yield adminmodel_1.Admin.findById({ _id: id });
        if (!admin) {
            res.status(400).json({
                error: "Admin not found",
            });
        }
        const updatedAdmin = yield adminmodel_1.Admin.findByIdAndUpdate(id, { name, username }, {
            new: true,
            runValidators: true,
            context: "query",
        });
        res
            .status(200)
            .json({ message: "Profile updated successfully", admin: updatedAdmin });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating profile" });
    }
});
exports.updateAdminProfile = updateAdminProfile;
const updateAdminPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { old_password, new_password, confirm_password } = req.body;
        const validateAmin = utils_1.UpdatePasswordSchema.validate(req.body, utils_1.option);
        if (validateAmin.error) {
            res.status(400).json({ Error: validateAmin.error.details[0].message });
        }
        const admin = yield adminmodel_1.Admin.findById({ _id: id });
        if (!admin) {
            res.status(400).json({
                error: "Admin not found",
            });
        }
        const updatedAdmin = yield adminmodel_1.Admin.findByIdAndUpdate(id, { old_password, new_password, confirm_password }, {
            new: true,
            runValidators: true,
            context: "query",
        });
        res.status(200).json({
            message: "Admin Password updated successfully",
            admin: updatedAdmin,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Error updating Passwords" });
    }
});
exports.updateAdminPassword = updateAdminPassword;
const deleteAdmin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield adminmodel_1.Admin.findByIdAndDelete(id);
        res.status(200).json({ message: "Admin deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ message: "Error deleting admin" });
    }
});
exports.deleteAdmin = deleteAdmin;
