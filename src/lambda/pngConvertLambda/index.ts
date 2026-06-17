import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { ensureConnection } from "./db.js";
import { Guest } from "./guestmodel.js";
import { Event } from "./eventmodel.js";
import { generateQrSvg } from "./generateQrSvg.js";
import { rgbToHex } from "./colorUtils.js";

const s3 = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event: any) => {
  try {
    const { guestId, eventId } = event;
    if (!guestId || !eventId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing fields" }),
      };
    }

    await ensureConnection();

    const guest = await Guest.findById(guestId);
    if (!guest) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Guest not found" }),
      };
    }

    const eventDoc = await Event.findById(eventId);
    if (!eventDoc) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Event not found" }),
      };
    }

    // Generate SVG QR code using the same method as downloadZipLambdaFunction
    const bgColorHex = rgbToHex(guest.qrCodeBgColor);
    const centerColorHex = rgbToHex(guest.qrCodeCenterColor);
    const edgeColorHex = rgbToHex(guest.qrCodeEdgeColor);

    const svg = generateQrSvg(
      guestId,
      bgColorHex,
      centerColorHex,
      edgeColorHex
    );

    // Convert SVG to PNG using the same method as downloadZipLambdaFunction
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    // Upload PNG to S3 at BOTH known paths:
    //   qr_codes/png/...        used by download/zip lambdas and guest.pngUrl
    //   qr_codes/email_png/...  used by WhatsApp template "View Digital Pass"
    //                           buttons (wedding_invite, rsvp_followup, and
    //                           any DB-created template with that URL prefix)
    // Same bytes, two keys — keeps existing templates working without a
    // separate backfill for new events.
    const pngKey = `qr_codes/png/${eventId}/${guestId}.png`;
    const emailPngKey = `qr_codes/email_png/${eventId}/${guestId}.png`;

    await Promise.all([
      s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: pngKey,
          Body: pngBuffer,
          ContentType: "image/png",
        })
      ),
      s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: emailPngKey,
          Body: pngBuffer,
          ContentType: "image/png",
        })
      ),
    ]);

    const pngUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${pngKey}`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        pngUrl,
        message: "PNG conversion successful",
      }),
    };
  } catch (err: any) {
    console.error("❌ PNG conversion error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error converting SVG to PNG",
        error: err.message,
      }),
    };
  }
};
