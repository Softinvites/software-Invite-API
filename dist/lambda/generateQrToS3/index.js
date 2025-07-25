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
const client_s3_1 = require("@aws-sdk/client-s3");
const generateQrSvg_js_1 = require("./generateQrSvg.js");
const colorUtils_js_1 = require("./colorUtils.js");
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const handler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { guestId, fullname, qrCodeBgColor, qrCodeCenterColor, qrCodeEdgeColor, eventId, TableNo, others, } = event;
        if (!guestId || !fullname || !eventId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields" }),
            };
        }
        // Convert colors to hex if needed
        const bgColorHex = (0, colorUtils_js_1.rgbToHex)(qrCodeBgColor);
        const centerColorHex = (0, colorUtils_js_1.rgbToHex)(qrCodeCenterColor);
        const edgeColorHex = (0, colorUtils_js_1.rgbToHex)(qrCodeEdgeColor);
        const svg = (0, generateQrSvg_js_1.generateQrSvg)(guestId, bgColorHex, centerColorHex, edgeColorHex);
        const safeName = fullname.replace(/[^a-zA-Z0-9-_]/g, "_");
        // const key = `qr_codes/${eventId}/${safeName}_${guestId}.svg`;
        const key = `qr_codes/${eventId}/${safeName}_${TableNo}_${others}_${guestId}.svg`;
        yield s3.send(new client_s3_1.PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: svg,
            ContentType: "image/svg+xml",
            // ACL: "public-read",
        }));
        const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        return {
            statusCode: 200,
            body: JSON.stringify({ qrCodeUrl: url }),
        };
    }
    catch (error) {
        console.error("Error generating QR:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Error generating QR code",
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        };
    }
});
exports.handler = handler;
