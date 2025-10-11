// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import { generateQrSvg } from "./generateQrSvg.js";
// import { rgbToHex } from "./colorUtils.js";

// interface LambdaEvent {
//   guestId: string;
//   fullname: string;
//   qrCodeBgColor: string;
//   qrCodeCenterColor: string;
//   qrCodeEdgeColor: string;
//   eventId: string;
//   TableNo: string;
//   others: string;
// }

// const s3 = new S3Client({ region: process.env.AWS_REGION });

// export const handler = async (event: LambdaEvent) => {
//   try {
//     const {
//       guestId,
//       fullname,
//       qrCodeBgColor,
//       qrCodeCenterColor,
//       qrCodeEdgeColor,
//       eventId,
//       TableNo,
//       others,
//     } = event;

//     if (!guestId || !fullname || !eventId) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({ message: "Missing required fields" }),
//       };
//     }

//     // Convert colors to hex if needed
//     const bgColorHex = rgbToHex(qrCodeBgColor);
//     const centerColorHex = rgbToHex(qrCodeCenterColor);
//     const edgeColorHex = rgbToHex(qrCodeEdgeColor);

//     const svg = generateQrSvg(
//       guestId,
//       bgColorHex,
//       centerColorHex,
//       edgeColorHex
//     );

//     const safeName = fullname.replace(/[^a-zA-Z0-9-_]/g, "_");

//     // const key = `qr_codes/${eventId}/${safeName}_${guestId}.svg`;
//     const key = `qr_codes/${eventId}/${safeName}_${TableNo}_${others}_${guestId}.svg`;

//     await s3.send(
//       new PutObjectCommand({
//         Bucket: process.env.S3_BUCKET,
//         Key: key,
//         Body: svg,
//         ContentType: "image/svg+xml",
//         // ACL: "public-read",
//       })
//     );

//     const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

//     return {
//       statusCode: 200,
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({ qrCodeUrl: url, qrSvg: svg, }),
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


import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { generateQrSvg } from "./generateQrSvg.js";
import { rgbToHex } from "./colorUtils.js";

interface LambdaEvent {
  guestId: string;
  fullname: string;
  qrCodeBgColor: string;
  qrCodeCenterColor: string;
  qrCodeEdgeColor: string;
  eventId: string;
  TableNo: string;
  others: string;
}

const s3 = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event: LambdaEvent) => {
  try {
    const {
      guestId,
      fullname,
      qrCodeBgColor,
      qrCodeCenterColor,
      qrCodeEdgeColor,
      eventId,
      TableNo,
      others,
    } = event;

    if (!guestId || !fullname || !eventId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing required fields" }),
      };
    }

    // Convert colors to hex if needed
    const bgColorHex = rgbToHex(qrCodeBgColor);
    const centerColorHex = rgbToHex(qrCodeCenterColor);
    const edgeColorHex = rgbToHex(qrCodeEdgeColor);

    const svg = generateQrSvg(
      guestId,
      bgColorHex,
      centerColorHex,
      edgeColorHex
    );

    const safeName = fullname.replace(/[^a-zA-Z0-9-_]/g, "_");
    const key = `qr_codes/${eventId}/${safeName}_${TableNo}_${others}_${guestId}.svg`;

    console.log("📁 Uploading to S3:", { bucket: process.env.S3_BUCKET, key: key });

    // Upload to S3 WITHOUT ACL (since bucket doesn't support it)
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: svg,
        ContentType: "image/svg+xml",
        // Remove ACL: "public-read" since bucket doesn't support it
      })
    );

    // Generate presigned URL that's valid for 7 days
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 604800 }); // 7 days

    console.log("✅ S3 Upload Successful, Presigned URL generated");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        qrCodeUrl: presignedUrl, 
        qrSvg: svg,
        message: "QR code generated and uploaded to S3 successfully"
      }),
    };
  } catch (error) {
    console.error("Error generating QR:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error generating QR code",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};