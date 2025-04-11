import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../db";

dotenv.config();

const dropEmailIndex = async () => {
  try {
    await connectDB();

    const db = mongoose.connection.db;

    if (!db) {
      throw new Error("❌ Database connection not initialized.");
    }

    const indexes = await db.collection("guests").indexInformation();
    console.log("📌 Existing Indexes:", indexes);

    if (indexes.email_1) {
      await db.collection("guests").dropIndex("email_1");
      console.log("✅ Dropped unique index on 'email'");
    } else {
      console.log("ℹ️ No 'email_1' index found");
    }
  } catch (error) {
    console.error("❌ Error dropping index:", error);
  } finally {
    await mongoose.disconnect();
  }
};

dropEmailIndex();
