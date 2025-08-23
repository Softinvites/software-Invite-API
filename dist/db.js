"use strict";
// import mongoose from "mongoose";
// import dotenv from "dotenv";
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
exports.connectDB = connectDB;
// dotenv.config();
// const url: string =
//   process.env.MONGODB_URL || "mongodb://localhost:27017/softinvites";
// export async function connectDB() {
//   try {
//     await mongoose.connect(url);
//     console.log("✅ Database connected");
//     // Ensure database is initialized
//     const db = mongoose.connection.db;
//     if (!db) {
//       console.error("❌ Database is not initialized");
//       return;
//     }
//   } catch (error) {
//     console.error("❌ Database connection error:", error);
//   }
// }
// import mongoose from "mongoose";
// import dotenv from "dotenv";
// dotenv.config();
// let cachedConnection: typeof mongoose | null = null;
// export async function connectDB() {
//   if (cachedConnection) {
//     return cachedConnection;
//   }
//   try {
//     const connection = await mongoose.connect(process.env.MONGODB_URI!, {
//       family: 4,
//       serverSelectionTimeoutMS: 30000,
//       socketTimeoutMS: 45000,
//       maxPoolSize: 10,
//     });
//     cachedConnection = connection;
//     console.log("✅ Database connected");
//     return connection;
//   } catch (error) {
//     console.error("❌ Database connection error:", error);
//     throw error;
//   }
// }
// // For Lambda cold starts
// export async function ensureConnection() {
//   if (!cachedConnection) {
//     await connectDB();
//   }
//   return cachedConnection!;
// }
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
let cachedConnection = null;
mongoose_1.default.set("bufferCommands", false); // 👈 important for Lambda
function connectDB() {
    return __awaiter(this, void 0, void 0, function* () {
        if (cachedConnection) {
            return cachedConnection;
        }
        try {
            const connection = yield mongoose_1.default.connect(process.env.MONGODB_URI, {
                family: 4,
                serverSelectionTimeoutMS: 30000, // wait up to 30s for MongoDB
                socketTimeoutMS: 45000,
                maxPoolSize: 10,
            });
            cachedConnection = connection;
            console.log("✅ Database connected");
            return connection;
        }
        catch (error) {
            console.error("❌ Database connection error:", error);
            throw error;
        }
    });
}
