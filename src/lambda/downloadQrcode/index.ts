import AWS from "aws-sdk";
import sharp from "sharp";
import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import { generateQrSvg } from "./generateQrSvg.js";
import { rgbToHex } from "./colorUtils.js";

const s3 = new AWS.S3();

// ✅ Sanitize names for filenames
function safeName(str: string) {
  return str ? str.replace(/[^a-zA-Z0-9._-]/g, "_") : "unknown";
}

export const handler = async (event: any) => {
  try {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET not configured");

    const guestId = event.pathParameters?.guestId;
    if (!guestId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Guest ID is required" }),
      };
    }

    // ✅ Connect to MongoDB
    await connectDB();

    // ✅ Find guest in database
    const guest = await Guest.findById(guestId);
    if (!guest) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Guest not found" }),
      };
    }

    // ✅ Extract color fields safely
    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

    // ✅ Generate QR SVG dynamically
    const svg = generateQrSvg(
      guest._id.toString(),
      bgColorHex,
      centerColorHex,
      edgeColorHex
    );


    console.log("✅ SVG length:", svg.length);
console.log("✅ SVG preview:", svg.substring(0, 300));

// Validate that the SVG starts with <svg
if (!svg.trim().startsWith("<svg")) {
  throw new Error("Generated SVG is invalid or empty");
}

let pngBuffer: Buffer;
try {
  pngBuffer = await sharp(Buffer.from(svg), { density: 300 })
    .png({ compressionLevel: 9 })
    .toBuffer();
} catch (err) {
  console.error("❌ Sharp conversion failed. SVG snippet:\n", svg.substring(0, 400));
  console.error("Error:", err);
  throw new Error("QR code image conversion failed");
}

    // ✅ Clean filename & S3 key
    const filename = `qr-${safeName(guest.fullname)}_${safeName(
      guest.TableNo
    )}_${safeName(guest.others)}_${guest._id}.png`;

    const key = `single_qrs/${guest._id}/${filename}`;

    // ✅ Upload to S3
    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: pngBuffer,
        ContentType: "image/png",
      })
      .promise();

    const fileUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    console.log(`✅ QR PNG uploaded: ${fileUrl}`);

    // ✅ Return response with file URL
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: JSON.stringify({
        message: "QR code generated successfully",
        guestId,
        filename,
        fileUrl,
      }),
    };
  } catch (error: unknown) {
    console.error("❌ Error downloading QR code:", error);

    // ✅ Safe handling of unknown error type
    const err =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error downloading QR code",
        error: err,
      }),
    };
  }
};
