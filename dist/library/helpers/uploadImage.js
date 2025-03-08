"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCSVExcel = exports.cloudinary = void 0;
const cloudinary_1 = require("cloudinary");
Object.defineProperty(exports, "cloudinary", { enumerable: true, get: function () { return cloudinary_1.v2; } });
const multer_storage_cloudinary_1 = require("multer-storage-cloudinary");
const multer_1 = __importDefault(require("multer"));
// import UserRequest from "../../types/userRequest";
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const csvExcelStorage = new multer_storage_cloudinary_1.CloudinaryStorage({
    cloudinary: cloudinary_1.v2,
    params: {
        resource_type: "auto",
        public_id: (req, file) => `uploads/${file.originalname}`, // Ensure file is saved in "uploads" folder
    }, // Explicitly cast to include `folder`
});
// ✅ Corrected File Filter with Proper Type Annotations
const fileFilter = (req, file, cb) => {
    if (file.mimetype === "text/csv" ||
        file.mimetype ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
        cb(null, true);
    }
    else {
        cb(new Error("Invalid file type. Only CSV and Excel files are allowed."));
    }
};
// ✅ Multer Middleware for CSV & Excel Uploads
exports.uploadCSVExcel = (0, multer_1.default)({
    storage: csvExcelStorage,
    fileFilter,
});
