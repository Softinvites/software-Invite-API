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
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const adminModel_1 = require("../../models/adminModel");
const jwtSecret = process.env.JWT_SECRET;
const auth = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
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
        const admin = yield adminModel_1.Admin.findById(verify._id);
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
});
exports.default = auth;
