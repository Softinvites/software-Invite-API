// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import sharp from "sharp";
// import { generateQrSvg } from "./generateQrSvg.js";
// interface LambdaEvent {
//   guestId: string;
//   fullname: string;
//   bgColorHex: string;
//   centerColorHex: string;
//   edgeColorHex: string;
//   eventId: string;
// }
// const s3 = new S3Client({ region: process.env.AWS_REGION });
// export const handler = async (event: LambdaEvent) => {
//   try {
//     const {
//       guestId,
//       fullname,
//       bgColorHex,
//       centerColorHex,
//       edgeColorHex,
//       eventId,
//     } = event;
//     // Validate input
//     if (!guestId || !fullname || !eventId) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({ message: "Missing required fields" }),
//       };
//     }
//     const svg = generateQrSvg(
//       guestId,
//       bgColorHex,
//       centerColorHex,
//       edgeColorHex
//     );
//     // Convert to PNG with better error handling
//     let pngBuffer: Buffer;
//     try {
//       pngBuffer = await sharp(Buffer.from(svg))
//         .resize(512, 512)
//         .png({ quality: 90 }) // Added quality parameter
//         .toBuffer();
//     } catch (sharpError) {
//       console.error("Sharp conversion error:", sharpError);
//       throw new Error("Failed to convert QR code to PNG");
//     }
//     // Upload to S3
//     const safeName = fullname.replace(/[^a-zA-Z0-9-_]/g, "_");
//     const key = `qr_codes/${eventId}/${safeName}_${guestId}.png`;
//     await s3.send(
//       new PutObjectCommand({
//         Bucket: process.env.S3_BUCKET,
//         Key: key,
//         Body: pngBuffer,
//         ContentType: "image/png",
//         ACL: "public-read",
//       })
//     );
//     const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
//     return {
//       statusCode: 200,
//       body: JSON.stringify({ qrCodeUrl: url }),
//     };
//   } catch (error) {
//     console.error("Error generating QR:", error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({
//         message: "Error generating QR code",
//         error: error instanceof Error ? error.message : "Unknown error",
//       }),
//     };
//   }
// };
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { generateQrSvg } from "./generateQrSvg.js";
const s3 = new S3Client({ region: process.env.AWS_REGION });
export const handler = async (event) => {
    const { guestId, fullname, bgColorHex, centerColorHex, edgeColorHex, eventId } = event;
    if (!guestId || !fullname || !eventId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Missing required fields" }),
        };
    }
    try {
        // Generate SVG QR code with gradients
        const svg = generateQrSvg(guestId, bgColorHex, centerColorHex, edgeColorHex);
        // Convert SVG buffer to PNG buffer with sharp (512x512, quality 90)
        const pngBuffer = await sharp(Buffer.from(svg))
            .resize(512, 512)
            .png({ quality: 90 })
            .toBuffer();
        // Safe S3 key
        const safeName = fullname.replace(/[^a-zA-Z0-9-_]/g, "_");
        const key = `qr_codes/${eventId}/${safeName}_${guestId}.png`;
        // Upload PNG to S3
        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: pngBuffer,
            ContentType: "image/png",
            ACL: "public-read",
        }));
        // Public URL for the uploaded QR PNG
        const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        return {
            statusCode: 200,
            body: JSON.stringify({ qrCodeUrl: url }),
        };
    }
    catch (error) {
        console.error("Error generating QR code:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Error generating QR code",
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        };
    }
};
