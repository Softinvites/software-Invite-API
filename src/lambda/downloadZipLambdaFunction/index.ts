import AWS from "aws-sdk";
import archiver from "archiver";
import { PassThrough } from "stream";
import sharp from "sharp";
import { generateQrSvg } from "./generateQrSvg.js"; 
import { rgbToHex } from "./colorUtils.js"; 

const s3 = new AWS.S3();

function safeName(str: string) {
  return str ? str.replace(/[^a-zA-Z0-9._-]/g, "_") : "unknown";
}

export const handler = async (event: any) => {
  try {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET not configured");

    const { qrItems, eventId } = event;
    if (!qrItems || !Array.isArray(qrItems) || qrItems.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "qrItems must be a non-empty array", eventId }),
      };
    }

    const archive = archiver("zip", { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    archive.pipe(zipStream);

    const addedFiles: string[] = [];
    const missingFiles: any[] = [];

    // 🚀 Process QR codes in parallel
    await Promise.all(
      qrItems.map(async (item, index) => {
        try {
          const { guestId, guestName, tableNo, others, qrCodeBgColor,qrCodeCenterColor, qrCodeEdgeColor} = item;

          // ✅ Use correct DB color variables + convert RGB → HEX
          const bgColorHex = rgbToHex(qrCodeBgColor);
          const centerColorHex = rgbToHex(qrCodeCenterColor);
          const edgeColorHex = rgbToHex(qrCodeEdgeColor);

          // 1. Generate QR SVG with gradient
          const svg = generateQrSvg(
            guestId || `guest_${index}`,
            bgColorHex,
            centerColorHex,
            edgeColorHex
          );

          // 2. Convert SVG → PNG
          const buffer = await sharp(Buffer.from(svg))
            .png()
            .toBuffer();

          // 3. Safe filename
          const filename = `qr-${safeName(guestName)}_${safeName(
            tableNo
          )}_${safeName(others)}_${guestId || index}.png`;

          archive.append(buffer, { name: filename });
          addedFiles.push(filename);
        } catch (err) {
          console.error("❌ Failed to process QR item:", item, err);
          missingFiles.push(item);
        }
      })
    );

    await archive.finalize();

    // Collect ZIP buffer
    const chunks: Buffer[] = [];
    for await (const chunk of zipStream) {
      chunks.push(chunk);
    }
    const zipBuffer = Buffer.concat(chunks);

    if (addedFiles.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "No QR codes processed, ZIP not created",
          missingFiles,
          eventId,
        }),
      };
    }

    // 🚀 Upload ZIP to S3
    const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
    await s3
      .putObject({
        Bucket: bucket,
        Key: zipKey,
        Body: zipBuffer,
        ContentType: "application/zip",
      })
      .promise();

    // 🚀 Public S3 URL
    const zipUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
    console.log(`✅ ZIP uploaded: ${zipUrl}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        zipUrl,
        eventId,
        generatedAt: new Date().toISOString(),
        numberOfFiles: addedFiles.length,
        addedFiles,
        missingFiles,
      }),
    };
  } catch (err: unknown) {
    console.error("❌ Error in Lambda:", err);
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    };
  }
};
