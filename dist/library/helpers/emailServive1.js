"use strict";
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
exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// ✅ Zoho Mail Transporter
const zohoTransporter = nodemailer_1.default.createTransport({
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS,
    },
});
// ✅ Brevo Mail Transporter
const brevoTransporter = nodemailer_1.default.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.ZOHO_USER, // Use Zoho email for Brevo SMTP authentication
        pass: process.env.BREVO_API_KEY,
    },
});
// ✅ Function to send email
const sendEmail = (recipient_1, subject_1, htmlContent_1, ...args_1) => __awaiter(void 0, [recipient_1, subject_1, htmlContent_1, ...args_1], void 0, function* (recipient, subject, htmlContent, useBrevo = false) {
    try {
        const transporter = useBrevo ? brevoTransporter : zohoTransporter;
        const mailOptions = {
            from: `"Event Organizer" <${process.env.ZOHO_USER}>`,
            to: recipient,
            subject,
            html: htmlContent,
        };
        const info = yield transporter.sendMail(mailOptions);
        console.log("Email sent: ", info.messageId);
    }
    catch (error) {
        console.error("Error sending email: ", error);
    }
});
exports.sendEmail = sendEmail;
