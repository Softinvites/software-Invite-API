import serverless from "serverless-http";
import createError, { HttpError } from "http-errors";
import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import logger from "morgan";
import cors, { CorsOptions } from "cors";
import dotenv from "dotenv";
import AdminRouter from "./routes/adminRoutes";
import EventRouter from "./routes/eventsRoutes";
import GuestRouter from "./routes/guestRoutes";
import WhatsAppRouter from "./routes/whatsappRoutes";
import WebhookRouter from "./routes/webhookRoutes";
import RsvpRouter from "./routes/rsvpRoutes";
import RsvpAdminRouter from "./routes/rsvpAdminRoutes";
import EmailRouter from "./routes/emailRoutes";
import ReportRouter from "./routes/reportRoutes";
import ContentTemplateRouter from "./routes/contentTemplateRoutes";
import ContactRouter from "./routes/contactRoutes";
import { dbConnect } from "./library/middlewares/dbConnect";
import {
  EVENT_FIELD_SIZE_LIMIT_BYTES,
  EVENT_FILE_COUNT_LIMIT,
  JSON_BODY_LIMIT,
  URLENCODED_BODY_LIMIT,
  formatBytes,
} from "./config/requestLimits";

dotenv.config();
const app = express();

if (
  process.env.RUN_SCHEDULER === "true" ||
  process.env.NODE_ENV === "development"
) {
  // fire-and-forget scheduler startup (node-cron)
  import("./jobs/messageScheduler.js")
    .then((mod) => mod.startMessageScheduler())
    .catch((error) => console.error("Failed to start message scheduler:", error));
}

const allowedOrigins: string[] = [
  // --- Admin dashboard (Softinvites-website-QR) ---
  "http://localhost:3039",
  "localhost:3039",
  "http://192.168.0.197:3039",
  "http://100.64.100.6:3039",

  // --- Production, softinvite.com ---
  // Serves BOTH the admin dashboard and the marketing website: the website is
  // proxied in on the marketing paths, so both share this single origin.
  "https://www.softinvite.com",
  "https://softinvite.com",

  // --- Marketing website (softinvites-web) dev server ---
  "http://localhost:3040",
  "http://127.0.0.1:3040",

  // --- Gate check-in scanner (qr-scanner) ---
  "https://softinvite-scan.vercel.app",

  "http://localhost:3000",
];

/**
 * Extra origins without a redeploy — comma-separated, e.g. a Vercel preview URL
 * while testing the marketing site before it goes on the domain:
 *   EXTRA_CORS_ORIGINS=https://softinvites-web.vercel.app,https://foo-git-bar.vercel.app
 */
const extraOrigins = (process.env.EXTRA_CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

/**
 * Vercel preview deployments get a new hostname per deploy, so they cannot be
 * enumerated. Allow them only when explicitly switched on, and never by default.
 *   ALLOW_VERCEL_PREVIEW_ORIGINS=true
 */
const allowVercelPreviews =
  String(process.env.ALLOW_VERCEL_PREVIEW_ORIGINS || "").toLowerCase() === "true";

const isAllowedOrigin = (origin: string): boolean => {
  const normalized = origin.replace(/\/$/, "");
  if (allowedOrigins.includes(normalized) || extraOrigins.includes(normalized)) {
    return true;
  }
  if (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalized)) {
    return true;
  }
  return false;
};

const corsOptions: CorsOptions = {
  // No Origin header means a same-origin request, a server-to-server call, or a
  // provider webhook (Twilio, Termii, Meta) — none of which CORS applies to.
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
// Answer preflight for every route, including the public contact endpoint,
// before any rate limiter or auth middleware can reject it.
app.options("*", cors(corsOptions));

// Behind API Gateway / Vercel the real client IP is in x-forwarded-for.
// express-rate-limit needs this to key the public contact endpoint per visitor
// rather than treating every request as coming from the proxy.
app.set("trust proxy", 1);

// --- Middleware ---
app.use(logger("dev"));
// Capture raw request body for webhook signature verification
app.use(
  express.json({
    limit: JSON_BODY_LIMIT,
    verify: (req: any, _res: any, buf: Buffer) => {
      req.rawBody = buf;
    },
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    limit: URLENCODED_BODY_LIMIT,
    parameterLimit: 2000,
  }),
);
app.use(cookieParser());
app.use(dbConnect); // ensures DB connection before any route

// --- Routes ---
app.use("/admin", AdminRouter);
app.use("/events", EventRouter);
app.use("/events", RsvpAdminRouter);
app.use("/guest", GuestRouter);
app.use("/whatsapp", WhatsAppRouter);
app.use("/webhook", WebhookRouter);
app.use("/rsvp", RsvpRouter);
app.use("/email", EmailRouter);
app.use("/reports", ReportRouter);
app.use("/content-templates", ContentTemplateRouter);
app.use("/contact", ContactRouter);

// --- Error handler ---
app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  const contentTypeHeader = req.headers["content-type"];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader.join(",").toLowerCase()
    : String(contentTypeHeader || "").toLowerCase();

  if ((err as any)?.type === "entity.too.large") {
    const isEventRequest = req.originalUrl.startsWith("/events");
    const isMultipart = contentType.includes("multipart/form-data");
    const parsedLimit = contentType.includes("application/x-www-form-urlencoded")
      ? URLENCODED_BODY_LIMIT
      : JSON_BODY_LIMIT;

    res.status(413).json({
      message: isEventRequest ? "Event payload too large" : "Request body too large",
      code: "REQUEST_ENTITY_TOO_LARGE",
      details:
        isEventRequest && isMultipart
          ? `Reduce the event payload size and try again. Text fields must stay under ${formatBytes(EVENT_FIELD_SIZE_LIMIT_BYTES)}, the form can include up to ${EVENT_FILE_COUNT_LIMIT} files, and deployed API requests must stay below 10 MB total. For larger assets, upload the file first and submit its URL instead of sending the file inside the event request.`
          : isEventRequest
            ? `Use multipart/form-data for event images and attachments. JSON and URL-encoded event payloads are limited to ${parsedLimit}.`
            : `Reduce the request size and try again. Request bodies of this type are limited to ${parsedLimit}.`,
    });
    return;
  }

  if ((err as any)?.name === "MulterError") {
    const multerCode = (err as any)?.code;
    const responses: Record<
      string,
      { status: number; message: string; details: string }
    > = {
      LIMIT_FILE_SIZE: {
        status: 413,
        message: "Uploaded file too large",
        details: "This upload exceeded the configured request size. Upload the asset directly first and submit its URL instead of sending the file inside the event request.",
      },
      LIMIT_FILE_COUNT: {
        status: 413,
        message: "Too many uploaded files",
        details: `An event request can include at most ${EVENT_FILE_COUNT_LIMIT} files.`,
      },
      LIMIT_FIELD_VALUE: {
        status: 413,
        message: "Form field too large",
        details: `Large event fields such as customMessageSequence must be ${formatBytes(EVENT_FIELD_SIZE_LIMIT_BYTES)} or smaller.`,
      },
      LIMIT_FIELD_COUNT: {
        status: 413,
        message: "Too many form fields",
        details: "Reduce the number of submitted fields and try again.",
      },
      LIMIT_PART_COUNT: {
        status: 413,
        message: "Too many multipart sections",
        details: "Reduce the number of files and form fields in this request.",
      },
      LIMIT_UNEXPECTED_FILE: {
        status: 400,
        message: "Unsupported file field",
        details: "Allowed file fields are iv and sequenceAttachment_*.",
      },
    };
    const response = responses[multerCode] || {
      status: 400,
      message: "Invalid upload payload",
      details: err.message,
    };
    res.status(response.status).json({
      message: response.message,
      code: multerCode || "INVALID_UPLOAD_PAYLOAD",
      details: response.details,
    });
    return;
  }

  if (
    err.message === "Only PNG is allowed for IV image" ||
    err.message === "Step attachment must be PNG, JPG, or PDF" ||
    err.message ===
      "Step attachment must be image (PNG, JPG, JPEG, WEBP, GIF) or PDF" ||
    err.message === "Unsupported file field"
  ) {
    res.status(400).json({
      message: err.message,
      code: "INVALID_UPLOAD_PAYLOAD",
    });
    return;
  }

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
