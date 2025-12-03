import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import xlsx from 'xlsx';
import csv from 'fast-csv';
import { Readable } from 'stream';

const s3 = new S3Client({ region: process.env.AWS_REGION });

function cleanValue(val: any): string {
  if (!val) return "";
  if (typeof val !== "string") return String(val);
  return val.trim();
}

function normalizeKeys(obj: any) {
  return {
    fullname: cleanValue(
      obj["fullname"] || obj["Full Name"] || obj["name"] || obj["Name"] || ""
    ),
    phone: cleanValue(obj["phone"] || ""),
    email: cleanValue(obj["email"] || ""),
    TableNo: cleanValue(
      obj["TableNo"] || obj["tableNo"] || obj["Table No"] || ""
    ),
    message: cleanValue(obj["message"] || ""),
    others: cleanValue(obj["others"] || ""),
    qrCodeBgColor: cleanValue(
      obj["qrCodeBgColor"] || obj["QR Code BG Color"] || "255,255,255"
    ),
    qrCodeCenterColor: cleanValue(
      obj["qrCodeCenterColor"] || obj["QR Code Center Color"] || "0,0,0"
    ),
    qrCodeEdgeColor: cleanValue(
      obj["qrCodeEdgeColor"] || obj["QR Code Edge Color"] || "0,0,0"
    ),
  };
}

function parseS3Url(fileUrl: string) {
  try {
    const url = new URL(fileUrl);
    const bucket = url.hostname.split('.')[0];
    const key = decodeURIComponent(url.pathname.slice(1));
    return { bucket, key };
  } catch (error) {
    console.error("Failed to parse S3 URL:", fileUrl, error);
    throw new Error(`Invalid S3 URL: ${fileUrl}`);
  }
}

export async function parseCsvExcel(fileUrl: string): Promise<any[]> {
  try {
    console.log("Processing file from URL:", fileUrl);
    const { bucket, key } = parseS3Url(fileUrl);
    console.log("Parsed S3 details:", { bucket, key });
    
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(command);
    
    if (!response.Body) {
      throw new Error("No file content received from S3");
    }
    
    const byteArray = await response.Body.transformToByteArray();
    const buffer = Buffer.from(byteArray);
    
    const fileExtension = key.split('.').pop()?.toLowerCase() || '';
    console.log("File extension:", fileExtension);
    
    if (fileExtension === 'csv') {
      return await new Promise((resolve, reject) => {
        const guests: any[] = [];
        const stream = Readable.from(buffer.toString());
        stream
          .pipe(csv.parse({ headers: true }))
          .on("data", (row) => guests.push(normalizeKeys(row)))
          .on("end", () => {
            console.log(`CSV parsing complete: ${guests.length} guests found`);
            resolve(guests);
          })
          .on("error", reject);
      });
    } else {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      if (!Array.isArray(data)) return [];
      
      const guests = data.map((row) => normalizeKeys(row));
      console.log(`Excel parsing complete: ${guests.length} guests found`);
      return guests;
    }
  } catch (error) {
    console.error("Error in parseCsvExcel:", error);
    return [];
  }
}