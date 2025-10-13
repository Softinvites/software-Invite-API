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
// import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
// import xlsx from 'xlsx';
// import csv from 'fast-csv';
// import { Readable } from 'stream';
// const s3 = new S3Client({ region: process.env.AWS_REGION });
// function cleanValue(val: any): string {
//   if (!val) return "";
//   if (typeof val !== "string") return String(val);
//   return val.trim();
// }
// function normalizeKeys(obj: any) {
//   return {
//     fullname: cleanValue(
//       obj["fullname"] || obj["Full Name"] || obj["name"] || obj["Name"] || ""
//     ),
//     phone: cleanValue(obj["phone"] || ""),
//     email: cleanValue(obj["email"] || ""),
//     TableNo: cleanValue(
//       obj["TableNo"] || obj["tableNo"] || obj["Table No"] || ""
//     ),
//     message: cleanValue(obj["message"] || ""),
//     others: cleanValue(obj["others"] || ""),
//     qrCodeBgColor: cleanValue(
//       obj["qrCodeBgColor"] || obj["QR Code BG Color"] || "255,255,255"
//     ),
//     qrCodeCenterColor: cleanValue(
//       obj["qrCodeCenterColor"] || obj["QR Code Center Color"] || "0,0,0"
//     ),
//     qrCodeEdgeColor: cleanValue(
//       obj["qrCodeEdgeColor"] || obj["QR Code Edge Color"] || "0,0,0"
//     ),
//   };
// }
// function parseS3Url(fileUrl: string) {
//   try {
//     // Handle both s3:// and https:// formats
//     if (fileUrl.startsWith('s3://')) {
//       // s3://bucket-name/key/path
//       const url = fileUrl.replace('s3://', '');
//       const [bucket, ...keyParts] = url.split('/');
//       const key = keyParts.join('/');
//       return { bucket, key };
//     } else {
//       // https://bucket-name.s3.region.amazonaws.com/key/path
//       const url = new URL(fileUrl);
//       const bucket = url.hostname.split('.')[0];
//       const key = decodeURIComponent(url.pathname.slice(1)); // Remove leading slash
//       return { bucket, key };
//     }
//   } catch (error) {
//     console.error("❌ Failed to parse S3 URL:", fileUrl, error);
//     throw new Error(`Invalid S3 URL: ${fileUrl}`);
//   }
// }
// export async function parseCsvExcel(fileUrl: string): Promise<any[]> {
//   try {
//     console.log("📥 Processing file from URL:", fileUrl);
//     // Parse S3 URL to get bucket and key
//     const { bucket, key } = parseS3Url(fileUrl);
//     console.log("🔍 Parsed S3 details:", { bucket, key });
//     // Use AWS SDK to get the file with proper authentication
//     const command = new GetObjectCommand({
//       Bucket: bucket,
//       Key: key,
//     });
//     const response = await s3.send(command);
//     if (!response.Body) {
//       throw new Error("No file content received from S3");
//     }
//     // Convert the response body to string using transformToString
//     const content = await response.Body.transformToString();
//     console.log("✅ File content loaded, length:", content.length);
//     // Determine file type and parse accordingly
//     const fileExtension = key.split('.').pop()?.toLowerCase() || '';
//     console.log("📄 File extension:", fileExtension);
//     // Fix for TypeScript error: explicitly check fileExtension type
//     if (fileExtension === 'csv') {
//       return await new Promise((resolve, reject) => {
//         const guests: any[] = [];
//         const stream = Readable.from(content);
//         stream
//           .pipe(csv.parse({ headers: true }))
//           .on("data", (row) => {
//             console.log("📝 Parsed row:", row);
//             guests.push(normalizeKeys(row));
//           })
//           .on("end", () => {
//             console.log(`✅ CSV parsing complete: ${guests.length} guests found`);
//             resolve(guests);
//           })
//           .on("error", (error) => {
//             console.error("❌ CSV parsing error:", error);
//             reject(error);
//           });
//       });
//     } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
//       console.log("📊 Processing Excel file");
//       // For Excel files, we need to work with the original buffer
//       // Re-fetch the file as buffer for Excel processing
//       const excelCommand = new GetObjectCommand({
//         Bucket: bucket,
//         Key: key,
//       });
//       const excelResponse = await s3.send(excelCommand);
//       if (!excelResponse.Body) {
//         throw new Error("No file content received for Excel processing");
//       }
//       // Convert to byte array for Excel
//       const byteArray = await excelResponse.Body.transformToByteArray();
//       const buffer = Buffer.from(byteArray);
//       const workbook = xlsx.read(buffer, { type: 'buffer' });
//       const sheetName = workbook.SheetNames[0];
//       console.log("📋 Sheet name:", sheetName);
//       const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
//       console.log("📝 Excel data sample:", data.slice(0, 2));
//       if (!Array.isArray(data)) {
//         console.error("❌ Excel data is not an array");
//         return [];
//       }
//       const guests = data.map((row) => normalizeKeys(row));
//       console.log(`✅ Excel parsing complete: ${guests.length} guests found`);
//       return guests;
//     } else {
//       throw new Error(`Unsupported file type: ${fileExtension}`);
//     }
//   } catch (error) {
//     console.error("❌ Error in parseCsvExcel:", error);
//     throw new Error(`Failed to parse file: ${error}`);
//   }
// }
// import fetch from 'node-fetch';
// import xlsx from 'xlsx';
// import csv from 'fast-csv';
// import { Readable } from 'stream';
// function cleanValue(val: any) {
//     if (!val)
//         return "";
//     if (typeof val !== "string")
//         return String(val);
//     return val.trim();
// }
// function normalizeKeys(obj: any) {
//     return {
//         fullname: cleanValue(obj["fullname"] || obj["Full Name"] || obj["name"] || obj["Name"] || ""),
//         phone: cleanValue(obj["phone"] || ""),
//         email: cleanValue(obj["email"] || ""),
//         TableNo: cleanValue(obj["TableNo"] || obj["tableNo"] || obj["Table No"] || ""),
//         message: cleanValue(obj["message"] || ""),
//         others: cleanValue(obj["others"] || ""),
//         qrCodeBgColor: cleanValue(obj["qrCodeBgColor"] || obj["QR Code BG Color"] || "255,255,255"),
//         qrCodeCenterColor: cleanValue(obj["qrCodeCenterColor"] || obj["QR Code Center Color"] || "0,0,0"),
//         qrCodeEdgeColor: cleanValue(obj["qrCodeEdgeColor"] || obj["QR Code Edge Color"] || "0,0,0"),
//         // ignore eventId column from CSV
//     };
// }
// export async function parseCsvExcel(fileUrl: string) {
//     try {
//         const res = await fetch(fileUrl);
//         console.log("Fetching file from URL:", fileUrl);
//         if (!res.ok)
//             throw new Error(`Failed to fetch file: ${res.statusText}`);
//         const buffer = await res.buffer();
//         const type = fileUrl.endsWith(".csv") ? "csv" : "excel";
//         if (type === "csv") {
//             return await new Promise((resolve, reject) => {
//               const guests: any[] = [];
//                 Readable.from(buffer.toString())
//                     .pipe(csv.parse({ headers: true }))
//                     .on("data", (row) => guests.push(normalizeKeys(row)))
//                     .on("end", () => resolve(guests))
//                     .on("error", reject);
//             });
//         }
//         else {
//             const workbook = xlsx.read(buffer);
//             const sheet = workbook.Sheets[workbook.SheetNames[0]];
//             const data = xlsx.utils.sheet_to_json(sheet);
//             if (!Array.isArray(data))
//                 return [];
//             return data.map((row) => normalizeKeys(row));
//         }
//     }
//     catch (error) {
//         console.error("Error in parseCsvExcel:", error);
//         return [];
//     }
// }
