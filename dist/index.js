"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const serverless_http_1 = __importDefault(require("serverless-http"));
const http_errors_1 = __importDefault(require("http-errors"));
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const morgan_1 = __importDefault(require("morgan"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const eventsRoutes_1 = __importDefault(require("./routes/eventsRoutes"));
const guestRoutes_1 = __importDefault(require("./routes/guestRoutes"));
const whatsappRoutes_1 = __importDefault(require("./routes/whatsappRoutes"));
const webhookRoutes_1 = __importDefault(require("./routes/webhookRoutes"));
const rsvpRoutes_1 = __importDefault(require("./routes/rsvpRoutes"));
const rsvpAdminRoutes_1 = __importDefault(require("./routes/rsvpAdminRoutes"));
const emailRoutes_1 = __importDefault(require("./routes/emailRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const contentTemplateRoutes_1 = __importDefault(require("./routes/contentTemplateRoutes"));
const dbConnect_1 = require("./library/middlewares/dbConnect");
const requestLimits_1 = require("./config/requestLimits");
dotenv_1.default.config();
const app = (0, express_1.default)();
if (process.env.RUN_SCHEDULER === "true" ||
    process.env.NODE_ENV === "development") {
    // fire-and-forget scheduler startup (node-cron)
    import("./jobs/messageScheduler.js")
        .then((mod) => mod.startMessageScheduler())
        .catch((error) => console.error("Failed to start message scheduler:", error));
}
const allowedOrigins = [
    "http://localhost:3039",
    "localhost:3039",
    "http://192.168.0.197:3039",
    "http://100.64.100.6:3039",
    "https://www.softinvite.com",
    "https://softinvite.com",
    "http://localhost:3000",
    "https://softinvite-scan.vercel.app",
];
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
};
app.use((0, cors_1.default)(corsOptions));
// --- Middleware ---
app.use((0, morgan_1.default)("dev"));
// Capture raw request body for webhook signature verification
app.use(express_1.default.json({
    limit: requestLimits_1.JSON_BODY_LIMIT,
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
app.use(express_1.default.urlencoded({
    extended: true,
    limit: requestLimits_1.URLENCODED_BODY_LIMIT,
    parameterLimit: 2000,
}));
app.use((0, cookie_parser_1.default)());
app.use(dbConnect_1.dbConnect); // ensures DB connection before any route
// --- Routes ---
app.use("/admin", adminRoutes_1.default);
app.use("/events", eventsRoutes_1.default);
app.use("/events", rsvpAdminRoutes_1.default);
app.use("/guest", guestRoutes_1.default);
app.use("/whatsapp", whatsappRoutes_1.default);
app.use("/webhook", webhookRoutes_1.default);
app.use("/rsvp", rsvpRoutes_1.default);
app.use("/email", emailRoutes_1.default);
app.use("/reports", reportRoutes_1.default);
app.use("/content-templates", contentTemplateRoutes_1.default);
// --- Error handler ---
app.use((err, req, res, next) => {
    console.error(err);
    const contentTypeHeader = req.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader.join(",").toLowerCase()
        : String(contentTypeHeader || "").toLowerCase();
    if (err?.type === "entity.too.large") {
        const isEventRequest = req.originalUrl.startsWith("/events");
        const isMultipart = contentType.includes("multipart/form-data");
        const parsedLimit = contentType.includes("application/x-www-form-urlencoded")
            ? requestLimits_1.URLENCODED_BODY_LIMIT
            : requestLimits_1.JSON_BODY_LIMIT;
        res.status(413).json({
            message: isEventRequest ? "Event payload too large" : "Request body too large",
            code: "REQUEST_ENTITY_TOO_LARGE",
            details: isEventRequest && isMultipart
                ? `Reduce the event payload size and try again. Text fields must stay under ${(0, requestLimits_1.formatBytes)(requestLimits_1.EVENT_FIELD_SIZE_LIMIT_BYTES)}, the form can include up to ${requestLimits_1.EVENT_FILE_COUNT_LIMIT} files, and deployed API requests must stay below 10 MB total. For larger assets, upload the file first and submit its URL instead of sending the file inside the event request.`
                : isEventRequest
                    ? `Use multipart/form-data for event images and attachments. JSON and URL-encoded event payloads are limited to ${parsedLimit}.`
                    : `Reduce the request size and try again. Request bodies of this type are limited to ${parsedLimit}.`,
        });
        return;
    }
    if (err?.name === "MulterError") {
        const multerCode = err?.code;
        const responses = {
            LIMIT_FILE_SIZE: {
                status: 413,
                message: "Uploaded file too large",
                details: "This upload exceeded the configured request size. Upload the asset directly first and submit its URL instead of sending the file inside the event request.",
            },
            LIMIT_FILE_COUNT: {
                status: 413,
                message: "Too many uploaded files",
                details: `An event request can include at most ${requestLimits_1.EVENT_FILE_COUNT_LIMIT} files.`,
            },
            LIMIT_FIELD_VALUE: {
                status: 413,
                message: "Form field too large",
                details: `Large event fields such as customMessageSequence must be ${(0, requestLimits_1.formatBytes)(requestLimits_1.EVENT_FIELD_SIZE_LIMIT_BYTES)} or smaller.`,
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
    if (err.message === "Only PNG is allowed for IV image" ||
        err.message === "Step attachment must be PNG, JPG, or PDF" ||
        err.message ===
            "Step attachment must be image (PNG, JPG, JPEG, WEBP, GIF) or PDF" ||
        err.message === "Unsupported file field") {
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
app.use((req, res, next) => {
    next((0, http_errors_1.default)(404, "Not Found"));
});
// --- Lambda handler ---
exports.handler = (0, serverless_http_1.default)(app);
// --- Local dev server ---
if (process.env.NODE_ENV === "development") {
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
