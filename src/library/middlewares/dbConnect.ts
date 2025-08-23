import { Request, Response, NextFunction } from "express";
import { connectDB } from "../../db";

export const dbConnect = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("DB connection error:", err);
    res.status(500).json({ message: "Database connection error" });
  }
};