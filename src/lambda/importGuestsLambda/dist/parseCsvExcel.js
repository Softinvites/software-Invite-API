import fetch from 'node-fetch';
import xlsx from 'xlsx';
import csv from 'fast-csv';
import { Readable } from 'stream';
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
export async function parseCsvExcel(fileUrl) {
    try {
        const res = await fetch(fileUrl);
        console.log("Fetching file from URL:", fileUrl);
        if (!res.ok)
            throw new Error(`Failed to fetch file: ${res.statusText}`);
        const buffer = await res.buffer();
        const type = fileUrl.endsWith(".csv") ? "csv" : "excel";
        if (type === "csv") {
            return await new Promise((resolve, reject) => {
                const guests = [];
                Readable.from(buffer.toString())
                    .pipe(csv.parse({ headers: true }))
                    .on("data", (row) => guests.push(normalizeKeys(row)))
                    .on("end", () => resolve(guests))
                    .on("error", reject);
            });
        }
        else {
            const workbook = xlsx.read(buffer);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = xlsx.utils.sheet_to_json(sheet);
            if (!Array.isArray(data))
                return [];
            return data.map((row) => normalizeKeys(row));
        }
    }
    catch (error) {
        console.error("Error in parseCsvExcel:", error);
        return [];
    }
}
