"use strict";
// import fetch from 'node-fetch';
// import xlsx from 'xlsx';
// import csv from 'fast-csv';
// import { Readable } from 'stream';
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
exports.parseCsvExcel = parseCsvExcel;
// export async function parseCsvExcel(fileUrl: string): Promise<any[]> {
//   try {
//     const res = await fetch(fileUrl);
//     if (!res.ok) throw new Error(`Failed to fetch file: ${res.statusText}`);
//     const buffer = await res.buffer();
//     const type = fileUrl.endsWith(".csv") ? "csv" : "excel";
//     if (type === "csv") {
//       return await new Promise((resolve, reject) => {
//         const guests: any[] = [];
//         Readable.from(buffer.toString())
//           .pipe(csv.parse({ headers: true }))
//           .on("data", (row) => guests.push(row))
//           .on("end", () => resolve(guests))
//           .on("error", reject);
//       });
//     } else {
//       const workbook = xlsx.read(buffer);
//       const sheet = workbook.Sheets[workbook.SheetNames[0]];
//       const data = xlsx.utils.sheet_to_json(sheet);
//       return Array.isArray(data) ? data : [];
//     }
//   } catch (error) {
//     console.error("Error in parseCsvExcel:", error);
//     return [];
//   }
// }
const node_fetch_1 = __importDefault(require("node-fetch"));
const xlsx_1 = __importDefault(require("xlsx"));
const fast_csv_1 = __importDefault(require("fast-csv"));
const stream_1 = require("stream");
function cleanValue(val) {
    if (!val)
        return "";
    if (typeof val !== "string")
        return String(val);
    return val.trim();
}
function normalizeKeys(obj) {
    return {
        fullname: cleanValue(obj["fullname"] || obj["Full Name"] || obj["name"] || obj["Name"] || ""),
        phone: cleanValue(obj["phone"] || ""),
        email: cleanValue(obj["email"] || ""),
        TableNo: cleanValue(obj["TableNo"] || obj["tableNo"] || obj["Table No"] || ""),
        message: cleanValue(obj["message"] || ""),
        others: cleanValue(obj["others"] || ""),
        qrCodeBgColor: cleanValue(obj["qrCodeBgColor"] || obj["QR Code BG Color"] || "255,255,255"),
        qrCodeCenterColor: cleanValue(obj["qrCodeCenterColor"] || obj["QR Code Center Color"] || "0,0,0"),
        qrCodeEdgeColor: cleanValue(obj["qrCodeEdgeColor"] || obj["QR Code Edge Color"] || "0,0,0"),
        // ignore eventId column from CSV
    };
}
function parseCsvExcel(fileUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const res = yield (0, node_fetch_1.default)(fileUrl);
            console.log("Fetching file from URL:", fileUrl);
            if (!res.ok)
                throw new Error(`Failed to fetch file: ${res.statusText}`);
            const buffer = yield res.buffer();
            const type = fileUrl.endsWith(".csv") ? "csv" : "excel";
            if (type === "csv") {
                return yield new Promise((resolve, reject) => {
                    const guests = [];
                    stream_1.Readable.from(buffer.toString())
                        .pipe(fast_csv_1.default.parse({ headers: true }))
                        .on("data", (row) => guests.push(normalizeKeys(row)))
                        .on("end", () => resolve(guests))
                        .on("error", reject);
                });
            }
            else {
                const workbook = xlsx_1.default.read(buffer);
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const data = xlsx_1.default.utils.sheet_to_json(sheet);
                if (!Array.isArray(data))
                    return [];
                return data.map((row) => normalizeKeys(row));
            }
        }
        catch (error) {
            console.error("Error in parseCsvExcel:", error);
            return [];
        }
    });
}
