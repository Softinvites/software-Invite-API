import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const url: string =
  process.env.MONGODB_URL || "mongodb://localhost:27017/softinvites";

export async function connectDB() {
  try {
    await mongoose.connect(url);
    console.log("✅ Database connected");

    // Ensure database is initialized
    const db = mongoose.connection.db;
    if (!db) {
      console.error("❌ Database is not initialized");
      return;
    }
  } catch (error) {
    console.error("❌ Database connection error:", error);
  }
}
