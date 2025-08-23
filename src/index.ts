// import serverless from 'serverless-http';
// import createError, { HttpError } from "http-errors";
// import express, { Request, Response, NextFunction } from "express";
// import cookieParser from "cookie-parser";
// import logger from "morgan";
// import cors from "cors";
// import { connectDB } from "./db";
// import dotenv from "dotenv";
// import AdminRouter from "./routes/adminRoutes";
// import EventRouter from "./routes/eventsRoutes";
// import GuestRouter from "./routes/guestRoutes";

// dotenv.config();
// const app = express();

// // CORS options
// const corsOptions = [
//   "http://localhost:3039",
//   "http://192.168.0.197:3039",
//   "http://100.64.100.6:3039",
//   'https://www.softinvite.com',
//   'https://softinvite.com',
//   "http://localhost:3000",
//   'https://softinvite-scan.vercel.app'
// ];

// app.use(cors({
//   origin: (origin, callback) => {
//     if (!origin || corsOptions.includes(origin)) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true
// }));

// // Middleware
// app.use(express.json());
// app.use(express.urlencoded({ extended: true })); // No need for body-parser
// app.use(cookieParser());
// app.use(logger("dev"));

// // app.options("*", cors(corsOptions)); // 👈 Allow preflight
// // app.use(cors(corsOptions)); // Apply CORS middleware

// // Routes
// app.use("/admin", AdminRouter);
// app.use("/events", EventRouter);
// app.use("/guest", GuestRouter);

// // Error handling middleware
// app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
//   console.error(err);
//   const status = err.status || 500;
//   const response = {
//     message: err.message,
//     ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
//   };
//   res.status(status).json(response);
// });

// // 404 handler for unknown routes
// app.use((req: Request, res: Response, next: NextFunction) => {
//   next(createError(404, "Not Found"));
// });

// // Connect to database
// connectDB();

// // Convert app to Lambda handler
// export const handler = serverless(app);

// // Start server
// // Local development server (optional)
// if (process.env.NODE_ENV === 'development') {
//   const PORT = process.env.PORT || 4000;
//   app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
//   });
// }

import serverless from "serverless-http";
import createError, { HttpError } from "http-errors";
import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import logger from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import AdminRouter from "./routes/adminRoutes";
import EventRouter from "./routes/eventsRoutes";
import GuestRouter from "./routes/guestRoutes";
import { dbConnect } from "./library/middlewares/dbConnect";

dotenv.config();
const app = express();

// --- CORS setup ---
const corsOptions = [
  "http://localhost:3039",
  "http://192.168.0.197:3039",
  "http://100.64.100.6:3039",
  "https://www.softinvite.com",
  "https://softinvite.com",
  "http://localhost:3000",
  "https://softinvite-scan.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOptions.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// --- Middleware ---
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(dbConnect); // ensures DB connection before any route

// --- Routes ---
app.use("/admin", AdminRouter);
app.use("/events", EventRouter);
app.use("/guest", GuestRouter);

// --- Error handler ---
app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  const status = err.status || 500;
  const response = {
    message: err.message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  };
  res.status(status).json(response);
});

// --- 404 handler ---
app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

// --- Lambda handler ---
export const handler = serverless(app);

// --- Local dev server ---
if (process.env.NODE_ENV === "development") {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
