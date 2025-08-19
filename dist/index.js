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
const db_1 = require("./db");
const dotenv_1 = __importDefault(require("dotenv"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const eventsRoutes_1 = __importDefault(require("./routes/eventsRoutes"));
const guestRoutes_1 = __importDefault(require("./routes/guestRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
// CORS options
const corsOptions = [
    "http://localhost:3039",
    "http://192.168.0.197:3039",
    "http://100.64.100.6:3039",
    'https://www.softinvite.com',
    'https://softinvite.com',
    "http://localhost:3000",
    'https://softinvite-scan.vercel.app'
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || corsOptions.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
// Middleware
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true })); // No need for body-parser
app.use((0, cookie_parser_1.default)());
app.use((0, morgan_1.default)("dev"));
// app.options("*", cors(corsOptions)); // 👈 Allow preflight
// app.use(cors(corsOptions)); // Apply CORS middleware
// Routes
app.use("/admin", adminRoutes_1.default);
app.use("/events", eventsRoutes_1.default);
app.use("/guest", guestRoutes_1.default);
// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err);
    const status = err.status || 500;
    const response = Object.assign({ message: err.message }, (process.env.NODE_ENV === "development" && { stack: err.stack }));
    res.status(status).json(response);
});
// 404 handler for unknown routes
app.use((req, res, next) => {
    next((0, http_errors_1.default)(404, "Not Found"));
});
// Connect to database
(0, db_1.connectDB)();
// Convert app to Lambda handler
exports.handler = (0, serverless_http_1.default)(app);
// Start server
// Local development server (optional)
if (process.env.NODE_ENV === 'development') {
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
