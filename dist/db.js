"use strict";
// import mongoose from "mongoose";
// import dotenv from "dotenv";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = void 0;
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
async function connectDB() {
    if (cachedConnection) {
        return cachedConnection;
    }
    try {
        const connection = await mongoose_1.default.connect(process.env.MONGODB_URI, {
            family: 4,
            serverSelectionTimeoutMS: 30000,
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
}
exports.connectDB = connectDB;
