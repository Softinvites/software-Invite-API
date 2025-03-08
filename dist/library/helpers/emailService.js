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
// Create a transporter using Gmail's SMTP
const transporter = nodemailer_1.default.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_ADDRESS, // Your Gmail email address
        pass: process.env.GMAIL_PASSWORD, // Your Gmail password or App Password
    },
});
// Define email options
const sendEmail = (recipient, subject, htmlContent) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const mailOptions = {
            from: `"Soft Invites" <${process.env.GMAIL_ADDRESS}>`,
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
