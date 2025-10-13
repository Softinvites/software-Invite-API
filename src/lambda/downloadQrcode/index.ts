import { connectDB } from "./db.js";
import { Guest } from "./guestmodel.js";
import sharp from "sharp";

export const handler = async (event: any) => {
  const guestId = event.pathParameters?.guestId;
  
  if (!guestId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Guest ID is required" }),
    };
  }

  try {
    await connectDB();

    // Find the guest
    const guest = await Guest.findById(guestId);
    if (!guest) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Guest not found" }),
      };
    }

    // Get the QR code URL
    const qrCodeUrl = guest.qrCode;
    if (!qrCodeUrl) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "QR code not found for this guest" }),
      };
    }

    // Download the SVG
    const response = await fetch(qrCodeUrl);
    if (!response.ok) {
      throw new Error(`Failed to download SVG: ${response.statusText}`);
    }

    const svgText = await response.text();

    // Convert SVG to PNG
    const pngBuffer = await sharp(Buffer.from(svgText))
      .resize(512, 512, { fit: "contain" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    // Safe filename logic
    const safeName = guest.fullname?.replace(/[^a-zA-Z0-9-_]/g, "_") || "guest";
    const safeTableNo = guest.TableNo?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noTable";
    const safeOthers = guest.others?.toString().replace(/[^a-zA-Z0-9-_]/g, "_") || "noOthers";

    const filename = `qr-${safeName}_${safeTableNo}_${safeOthers}_${guestId}.png`;

    // Return as base64 encoded response
    return {
      isBase64Encoded: true,
      statusCode: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: pngBuffer.toString("base64"),
    };

  } catch (error) {
    console.error("❌ Error downloading QR code:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: "Error downloading QR code",
        error: error 
      }),
    };
  }
};