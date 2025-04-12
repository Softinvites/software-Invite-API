import createError, { HttpError } from "http-errors";
import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import logger from "morgan";
import cors from "cors";
import { connectDB } from "./db";
import dotenv from "dotenv";
import AdminRouter from "./routes/adminRoutes";
import EventRouter from "./routes/eventsRoutes";
import GuestRouter from "./routes/guestRoutes";

dotenv.config();
const app = express();

// CORS options
const corsOptions = {
  origin: [
    "http://localhost:3039",
    "http://192.168.0.197:3039",
    "http://100.64.100.6:3039",
    "https://www.softinvite.com",
    "https://softinvite.com",
    "http://localhost:3000",
    "https://softinvite-scan.vercel.app"
  ],
  credentials: true,
};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // No need for body-parser
app.use(cookieParser());
app.use(logger("dev"));
app.use(cors(corsOptions)); // Apply CORS middleware

// Security headers with helmet

// Handle preflight CORS requests
app.options("*", cors(corsOptions)); // Handle OPTIONS preflight requests

// Routes
app.use("/admin", AdminRouter);
app.use("/events", EventRouter);
app.use("/guest", GuestRouter);

// Error handling middleware
app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  const status = err.status || 500;
  const response = {
    message: err.message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  };
  res.status(status).json(response);
});

// 404 handler for unknown routes
app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

// Connect to database
connectDB();

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
