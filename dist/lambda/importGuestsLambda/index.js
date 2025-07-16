"use strict";
// import { v4 as uuidv4 } from "uuid";
// import { parseCsvExcel } from "./parseCsvExcel.js";
// import { handler as generateQrToS3 } from "./generateQrToS3.js";
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
// export const handler = async (event: { fileUrl: string; eventId: string }) => {
//   const { fileUrl, eventId } = event;
//   if (!fileUrl || !eventId) {
//     return {
//       statusCode: 400,
//       body: JSON.stringify({ message: "Missing fileUrl or eventId" }),
//     };
//   }
//   try {
//     console.log("Fetching guests from file URL:", fileUrl);
//     const guests: any[] = await parseCsvExcel(fileUrl);
//     if (!Array.isArray(guests) || guests.length === 0) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           message: "No valid guests found in file.",
//           guests: [],
//           successful: 0,
//         }),
//       };
//     }
//     // Filter only guests with fullname and color fields
//     const validGuests = guests.filter(
//       (g) =>
//         g.fullname &&
//         g.fullname.trim() !== "" &&
//         g.qrCodeBgColor &&
//         g.qrCodeCenterColor &&
//         g.qrCodeEdgeColor
//     );
//     if (validGuests.length === 0) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           message: "No valid guests found in file after filtering.",
//           guests: [],
//           successful: 0,
//         }),
//       };
//     }
//     const results = [];
//     const batchSize = 10;
//     for (let i = 0; i < validGuests.length; i += batchSize) {
//       const batch = validGuests.slice(i, i + batchSize);
//       const batchResults = await Promise.allSettled(
//         batch.map(async (guest, index) => {
//           try {
//             const guestId = uuidv4();
//             const qrResponse = await generateQrToS3({
//               guestId,
//               fullname: guest.fullname,
//               qrCodeBgColor: guest.qrCodeBgColor,
//               qrCodeCenterColor: guest.qrCodeCenterColor,
//               qrCodeEdgeColor: guest.qrCodeEdgeColor,
//               eventId,
//             });
//             const qrData = JSON.parse(qrResponse.body);
//             return {
//               fullname: guest.fullname,
//               email: guest.email || "",
//               phone: guest.phone || "",
//               message: guest.message || "",  // Required for DB
//               others: guest.others || "",
//               TableNo: guest.TableNo || "",
//               qrCodeUrl: qrData.qrCodeUrl,
//               qrCodeBgColor: guest.qrCodeBgColor,
//               qrCodeCenterColor: guest.qrCodeCenterColor,
//               qrCodeEdgeColor: guest.qrCodeEdgeColor,
//               success: true,
//             };
//           } catch (error) {
//             console.error(`Failed to process guest at index ${i + index}:`, error);
//             return {
//               fullname: guest.fullname ?? "Unknown",
//               error: error instanceof Error ? error.message : "Unknown error",
//               success: false,
//             };
//           }
//         })
//       );
//       results.push(...batchResults);
//     }
//     return {
//       statusCode: 200,
//       body: JSON.stringify({
//         guests: results,
//         totalProcessed: guests.length,
//         successful: results.filter((r) => r.status === "fulfilled" && r.value?.success).length,
//         failed: results.filter((r) => r.status === "rejected" || r.value?.success === false).length,
//       }),
//     };
//   } catch (error) {
//     console.error("Error importing guests:", error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({
//         message: "Error importing guests",
//         error: error instanceof Error ? error.message : "Unknown error",
//       }),
//     };
//   }
// };
const uuid_1 = require("uuid");
const parseCsvExcel_js_1 = require("./parseCsvExcel.js");
const generateQrToS3_js_1 = require("./generateQrToS3.js");
const colorUtils_js_1 = require("./colorUtils.js");
const handler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    const { fileUrl, eventId } = event;
    if (!fileUrl || !eventId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Missing fileUrl or eventId" }),
        };
    }
    try {
        console.log("Fetching guests from file URL:", fileUrl);
        const guests = yield (0, parseCsvExcel_js_1.parseCsvExcel)(fileUrl);
        if (!Array.isArray(guests) || guests.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "No valid guests found in file.",
                    guests: [],
                    successful: 0,
                }),
            };
        }
        const validGuests = guests.filter((g) => g.fullname &&
            g.fullname.trim() !== "" &&
            g.qrCodeBgColor &&
            g.qrCodeCenterColor &&
            g.qrCodeEdgeColor);
        if (validGuests.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "No valid guests found in file after filtering.",
                    guests: [],
                    successful: 0,
                }),
            };
        }
        const results = [];
        const batchSize = 10;
        for (let i = 0; i < validGuests.length; i += batchSize) {
            const batch = validGuests.slice(i, i + batchSize);
            const batchResults = yield Promise.allSettled(batch.map((guest, index) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f;
                try {
                    if (!guest.fullname ||
                        !guest.qrCodeBgColor ||
                        !guest.qrCodeCenterColor ||
                        !guest.qrCodeEdgeColor) {
                        throw new Error("Missing required guest fields");
                    }
                    const guestId = (0, uuid_1.v4)();
                    const bgColorHex = (0, colorUtils_js_1.rgbToHex)(guest.qrCodeBgColor);
                    const centerColorHex = (0, colorUtils_js_1.rgbToHex)(guest.qrCodeCenterColor);
                    const edgeColorHex = (0, colorUtils_js_1.rgbToHex)(guest.qrCodeEdgeColor);
                    const qrResponse = yield (0, generateQrToS3_js_1.handler)({
                        guestId,
                        fullname: guest.fullname,
                        qrCodeBgColor: bgColorHex,
                        qrCodeCenterColor: centerColorHex,
                        qrCodeEdgeColor: edgeColorHex,
                        eventId,
                    });
                    const qrData = JSON.parse(qrResponse.body);
                    return {
                        fullname: guest.fullname,
                        TableNo: (_a = guest.TableNo) !== null && _a !== void 0 ? _a : "",
                        email: (_b = guest.email) !== null && _b !== void 0 ? _b : "",
                        phone: (_c = guest.phone) !== null && _c !== void 0 ? _c : "",
                        message: (_d = guest.message) !== null && _d !== void 0 ? _d : "You are invited!", // fallback default if missing
                        others: (_e = guest.others) !== null && _e !== void 0 ? _e : "",
                        qrCodeUrl: qrData.qrCodeUrl,
                        qrCodeData: guestId, // so DB can store this too
                        qrCodeBgColor: guest.qrCodeBgColor,
                        qrCodeCenterColor: guest.qrCodeCenterColor,
                        qrCodeEdgeColor: guest.qrCodeEdgeColor,
                        success: true,
                    };
                }
                catch (error) {
                    console.error(`Failed to process guest at index ${i + index}:`, error);
                    return {
                        fullname: (_f = guest.fullname) !== null && _f !== void 0 ? _f : "Unknown",
                        error: error instanceof Error ? error.message : "Unknown error",
                        success: false,
                    };
                }
            })));
            results.push(...batchResults);
        }
        return {
            statusCode: 200,
            body: JSON.stringify({
                guests: results,
                totalProcessed: guests.length,
                successful: results.filter((r) => r.status === "fulfilled").length,
                failed: results.filter((r) => r.status === "rejected").length,
            }),
        };
    }
    catch (error) {
        console.error("Error importing guests:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Error importing guests",
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        };
    }
});
exports.handler = handler;
