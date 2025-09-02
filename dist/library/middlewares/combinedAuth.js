"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.combinedAuth = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const adminmodel_1 = require("../../models/adminmodel");
const jwtSecret = process.env.JWT_SECRET;
const combinedAuth = async (req, res, next) => {
    const token = req.query.token ||
        req.headers["x-access-token"] ||
        req.headers.authorization?.split(" ")[1];
    if (!token) {
        res.status(403).json({ message: "No token provided" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
        if (typeof decoded === "object" && decoded !== null) {
            // ✅ Temp token for check-in staff
            if (decoded.type === "checkin" && decoded.eventId) {
                req.eventId = decoded.eventId; // Extract eventId
                return next();
            }
            // ✅ Admin token
            if (decoded._id) {
                const admin = await adminmodel_1.Admin.findById(decoded._id);
                if (admin) {
                    req.admin = { _id: decoded._id };
                    return next();
                }
            }
        }
        res.status(403).json({ message: "Unauthorized access" });
    }
    catch (error) {
        console.error("Auth error:", error);
        res.status(401).json({ message: "Invalid or expired token" });
    }
};
exports.combinedAuth = combinedAuth;
