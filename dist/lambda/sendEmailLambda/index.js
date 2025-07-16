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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_ses_1 = require("@aws-sdk/client-ses");
const client_s3_1 = require("@aws-sdk/client-s3");
const buildRawEmail_js_1 = require("./buildRawEmail.js");
const ses = new client_ses_1.SESClient({ region: process.env.AWS_REGION });
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const handler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const from = event.from || process.env.EMAIL_FROM;
        // ✅ Ensure 'from' is defined
        if (!from) {
            throw new Error("Sender email (from) is required");
        }
        const attachments = yield Promise.all((event.attachments || []).map((file) => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield s3.send(new client_s3_1.GetObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: file.s3Key,
            }));
            if (!response.Body) {
                throw new Error(`Unable to read S3 object for ${file.filename}`);
            }
            // ✅ Ensure Body is converted to base64 safely
            const byteArray = yield response.Body.transformToByteArray();
            const base64 = Buffer.from(byteArray).toString("base64");
            return {
                filename: file.filename,
                content: base64,
                contentType: file.contentType,
            };
        })));
        const rawMessage = (0, buildRawEmail_js_1.buildRawEmail)({
            from,
            to: event.to,
            subject: event.subject,
            htmlContent: event.htmlContent,
            attachments,
        });
        yield ses.send(new client_ses_1.SendRawEmailCommand({
            RawMessage: { Data: Buffer.from(rawMessage) },
        }));
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Email sent successfully" }),
        };
    }
    catch (error) {
        console.error("Error sending email:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Failed to send email",
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        };
    }
});
exports.handler = handler;
