"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const adminmodel_1 = require("../../models/adminmodel");
const jwtSecret = process.env.JWT_SECRET;
const auth = async (req, res, next) => {
    try {
        const authorization = req.headers.authorization;
        if (!authorization || !authorization.startsWith("Bearer ")) {
            res.status(401).json({ message: "Kindly sign in as a user" });
            return; // Ensure function exits
        }
        const token = authorization.split(" ")[1];
        let verify;
        try {
            verify = jsonwebtoken_1.default.verify(token, jwtSecret);
        }
        catch (err) {
            res.status(401).json({ message: "Invalid or expired token" });
            return; // Ensure function exits
        }
        const admin = await adminmodel_1.Admin.findById(verify._id);
        if (!admin) {
            res.status(404).json({ message: "User not found" });
            return; // Ensure function exits
        }
        req.admin = verify;
        next(); // Call next to continue request flow
    }
    catch (error) {
        console.error("Auth Middleware Error:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};
exports.default = auth;
