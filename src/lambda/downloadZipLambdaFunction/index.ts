// import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
// import archiver from "archiver";
// import { PassThrough } from "stream";

// const s3 = new S3Client({ region: process.env.AWS_REGION });

// function safe(str: string) {
//   return str.replace(/[^a-zA-Z0-9._-]/g, "_");
// }

// function buildSvgName(item: { key: string; guestName: string; tableNo: string }): string {
//   const baseName = item.key.split("/").pop() || `qr_${Date.now()}.svg`;
//   const nameNoExt = baseName.replace(/\.svg$/i, "");
//   const guest = safe(item.guestName || "Guest");
//   const table = safe(item.tableNo || "NoTable");
//   return `${guest}_Table-${table}_${nameNoExt}.svg`;
// }

// async function streamToBuffer(stream: any): Promise<Buffer> {
//   return new Promise((resolve, reject) => {
//     const chunks: Buffer[] = [];
//     stream.on("data", (c: Buffer) => chunks.push(c));
//     stream.on("end", () => resolve(Buffer.concat(chunks)));
//     stream.on("error", reject);
//   });
// }

// export const handler = async (event: any) => {
//   const { eventId, qrItems } = event;

//   console.log("📥 Incoming event:", JSON.stringify(event, null, 2));

//   if (!qrItems || !Array.isArray(qrItems) || qrItems.length === 0) {
//     console.warn("⚠️ No qrItems provided!");
//     return {
//       statusCode: 400,
//       body: JSON.stringify({ error: "qrItems must be a non-empty array", eventId }),
//     };
//   }

//   const archive = archiver("zip", { zlib: { level: 9 } });
//   const pass = new PassThrough();
//   const chunks: Buffer[] = [];
//   const collectZipBuffer = new Promise<Buffer>((resolve, reject) => {
//     pass.on("data", (chunk) => chunks.push(chunk as Buffer));
//     pass.on("end", () => resolve(Buffer.concat(chunks)));
//     pass.on("error", reject);
//   });
//   archive.pipe(pass);

//   const addedFiles: string[] = [];
//   const missingFiles: string[] = [];

//   for (const item of qrItems) {
//     try {
//       console.log(`🔍 Fetching from S3: bucket=${process.env.S3_BUCKET}, key=${item.key}`);
//       const { Body } = await s3.send(
//         new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: item.key })
//       );

//       if (!Body) throw new Error("Empty S3 Body");

//       const svgBuffer = await streamToBuffer(Body as any);
//       const outName = buildSvgName(item);
//       console.log(`🖼️ Adding SVG to archive as: ${outName}`);

//       archive.append(svgBuffer, { name: outName, date: new Date() });
//       addedFiles.push(item.key);
//     } catch (err) {
//       console.error(`❌ Could not fetch S3 object: ${item.key}`, err);
//       missingFiles.push(item.key);
//     }
//   }

//   await archive.finalize();
//   const zipBuffer = await collectZipBuffer;

//   if (!zipBuffer.length || addedFiles.length === 0) {
//     return {
//       statusCode: 400,
//       body: JSON.stringify({
//         error: "No QR code files were found in S3. ZIP not created.",
//         eventId,
//         missingFiles,
//       }),
//     };
//   }

//   const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
//   console.log(`📤 Uploading ZIP to S3: ${zipKey} (${zipBuffer.length} bytes)`);

//   await s3.send(
//     new PutObjectCommand({
//       Bucket: process.env.S3_BUCKET,
//       Key: zipKey,
//       Body: zipBuffer,
//       ContentType: "application/zip",
//     })
//   );

//   const zipUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
//   console.log(`✅ ZIP uploaded: ${zipUrl}`);

//   return {
//     statusCode: 200,
//     body: JSON.stringify({
//       zipUrl,
//       eventId,
//       generatedAt: new Date().toISOString(),
//       numberOfFiles: addedFiles.length,
//       addedFiles,
//       missingFiles,
//     }),
//   };
// };







// import {
//   S3Client,
//   GetObjectCommand,
//   PutObjectCommand,
// } from "@aws-sdk/client-s3";
// import archiver from "archiver";
// import { PassThrough } from "stream";
// import sharp from "sharp"

// const s3 = new S3Client({ region: process.env.AWS_REGION });

// export const handler = async (event: { qrPaths: string[]; eventId: string }) => {
//   const { qrPaths, eventId } = event;

//   if (!qrPaths || !Array.isArray(qrPaths) || qrPaths.length === 0) {
//     return {
//       statusCode: 400,
//       body: JSON.stringify({
//         error: "qrPaths must be a non-empty array",
//         eventId,
//       }),
//     };
//   }

//   const archive = archiver("zip", { zlib: { level: 9 } });
//   const pass = new PassThrough();
//   const chunks: Buffer[] = [];

//   const collectZipBuffer = new Promise<Buffer>((resolve, reject) => {
//     pass.on("data", (chunk) => chunks.push(chunk));
//     pass.on("end", () => resolve(Buffer.concat(chunks)));
//     pass.on("error", reject);
//   });

//   archive.pipe(pass);

//   const addedFiles: string[] = [];
//   const missingFiles: string[] = [];

//   for (const key of qrPaths) {
//     try {
//       const { Body } = await s3.send(
//         new GetObjectCommand({
//           Bucket: process.env.S3_BUCKET!,
//           Key: key,
//         })
//       );

//       if (Body) {
//         const svgBuffer = await streamToBuffer(Body as any);

//         // convert SVG -> PNG
//         const pngBuffer = await sharp(svgBuffer)
//           .resize(512, 512, { fit: "contain" })
//           .png({ compressionLevel: 9, adaptiveFiltering: true })
//           .toBuffer();

//         // rename file extension to .png
//         const baseName = key.split("/").pop()?.replace(/\.svg$/i, ".png") || `qr_${Date.now()}.png`;

//         archive.append(pngBuffer, {
//           name: baseName,
//           date: new Date(),
//         });

//         addedFiles.push(key);
//       }
//     } catch (err) {
//       console.error(`❌ Could not fetch/convert S3 object: ${key}`, err);
//       missingFiles.push(key);
//     }
//   }

//   await archive.finalize();
//   const zipBuffer = await collectZipBuffer;

//   if (!zipBuffer.length || addedFiles.length === 0) {
//     return {
//       statusCode: 400,
//       body: JSON.stringify({
//         error: "No QR code files were found or converted. ZIP not created.",
//         eventId,
//         missingFiles,
//       }),
//     };
//   }

//   const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;

//   await s3.send(
//     new PutObjectCommand({
//       Bucket: process.env.S3_BUCKET!,
//       Key: zipKey,
//       Body: zipBuffer,
//       ContentType: "application/zip",
//       ACL: "public-read",
//     })
//   );

//   const zipUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;

//   return {
//     statusCode: 200,
//     body: JSON.stringify({
//       zipUrl,
//       eventId,
//       generatedAt: new Date().toISOString(),
//       numberOfFiles: addedFiles.length,
//       addedFiles,
//       missingFiles,
//     }),
//   };
// };

// async function streamToBuffer(stream: any): Promise<Buffer> {
//   return new Promise((resolve, reject) => {
//     const chunks: Buffer[] = [];
//     stream.on("data", (chunk: Buffer) => chunks.push(chunk));
//     stream.on("end", () => resolve(Buffer.concat(chunks)));
//     stream.on("error", reject);
//   });
// }



// import AWS from "aws-sdk";
// import archiver from "archiver";
// import { PassThrough } from "stream";
// import sharp from "sharp";

// const s3 = new AWS.S3();

// function safe(str: string) {
//   return str.replace(/[^a-zA-Z0-9._-]/g, "_");
// }

// export const handler = async (event: any) => {
//   try {
//     const bucket = process.env.S3_BUCKET as string;
//     if (!bucket) throw new Error("S3_BUCKET not configured");

//     const { qrItems, eventId } = event;

//     if (!qrItems || !Array.isArray(qrItems) || qrItems.length === 0) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           error: "qrItems must be a non-empty array",
//           eventId,
//         }),
//       };
//     }

//     console.log("📥 Incoming qrItems:", qrItems);

//     // Prepare archive
//     const archive = archiver("zip", { zlib: { level: 9 } });
//     const pass = new PassThrough();
//     const chunks: Buffer[] = [];
//     const collectZipBuffer = new Promise<Buffer>((resolve, reject) => {
//       pass.on("data", (chunk) => chunks.push(chunk as Buffer));
//       pass.on("end", () => resolve(Buffer.concat(chunks)));
//       pass.on("error", reject);
//     });
//     archive.pipe(pass);

//     const addedFiles: string[] = [];
//     const missingFiles: string[] = [];

//     for (const item of qrItems) {
//       try {
//         if (!item.key) {
//           missingFiles.push(item);
//           continue;
//         }

//         console.log(`🔍 Fetching from S3: ${item.key}`);
//         const obj = await s3.getObject({ Bucket: bucket, Key: item.key }).promise();
//         const svgBuffer = obj.Body as Buffer;

//         // Convert SVG → PNG
//         const pngBuffer = await sharp(svgBuffer).png().toBuffer();

//         // Build safe filename
//         const baseName = item.key.split("/").pop()?.replace(/\.svg$/i, "") || `qr_${Date.now()}`;
//         const guest = safe(item.guestName || "Guest");
//         const table = safe(item.tableNo || "NoTable");
//         const outName = `${guest}_Table-${table}_${baseName}.png`;

//         archive.append(pngBuffer, { name: outName });
//         addedFiles.push(item.key);
//       } catch (err) {
//         console.error(`❌ Could not fetch or process: ${item.key}`, err);
//         missingFiles.push(item.key);
//       }
//     }

//     await archive.finalize();
//     const zipBuffer = await collectZipBuffer;

//     if (!zipBuffer.length || addedFiles.length === 0) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           error: "No QR code files were processed. ZIP not created.",
//           missingFiles,
//           eventId,
//         }),
//       };
//     }

//     // Upload ZIP to S3
//     const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
//     await s3.putObject({
//       Bucket: bucket,
//       Key: zipKey,
//       Body: zipBuffer,
//       ContentType: "application/zip",
//     }).promise();


// const zipUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;

//     console.log(`✅ ZIP uploaded: ${zipUrl}`);

//     return {
//       statusCode: 200,
//       body: JSON.stringify({
//         zipUrl,
//         eventId,
//         generatedAt: new Date().toISOString(),
//         numberOfFiles: addedFiles.length,
//         addedFiles,
//         missingFiles,
//       }),
//     };
//   } catch (err: any) {
//     console.error("❌ Error in Lambda:", err);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ error: err.message || "Internal Server Error" }),
//     };
//   }
// };


// import AWS from "aws-sdk";
// import archiver from "archiver";
// import { PassThrough } from "stream";
// import sharp from "sharp";
// import QRCode from "qrcode-svg";
// import { rgbToHex } from "./colorUtils.js";
// import { handler as generateQrToS3 } from "./generateQrToS3.js";

// const s3 = new AWS.S3();

// function safe(str: string) {
//   return str.replace(/[^a-zA-Z0-9._-]/g, "_");
// }

// function generateQrSvg(guestId: string, bgColor: string, centerColor: string, edgeColor: string) {
//   const qr = new QRCode({
//     content: guestId,
//     padding: 5,
//     width: 512,
//     height: 512,
//     color: edgeColor,
//     background: bgColor,
//     xmlDeclaration: false,
//   });

//   let svg = qr.svg();

//   svg = svg.replace(
//     /<svg([^>]*)>/,
//     `<svg$1>
//       <defs>
//         <radialGradient id="grad1" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
//           <stop offset="0%" stop-color="${centerColor}" stop-opacity="1"/>
//           <stop offset="100%" stop-color="${edgeColor}" stop-opacity="1"/>
//         </radialGradient>
//       </defs>`
//   );

//   svg = svg.replace(
//     /<rect([^>]*?)style="fill:#[0-9a-fA-F]{3,6};([^"]*)"/g,
//     (match, group1, group2) => {
//       const isBoundingRect = /x="0".*y="0"/.test(group1);
//       return isBoundingRect
//         ? `<rect${group1}style="fill:${bgColor};${group2}"/>`
//         : `<rect${group1}style="fill:url(#grad1);${group2}"/>`;
//     }
//   );

//   return svg;
// }

// export const handler = async (event: any) => {
//   try {
    // const bucket = process.env.S3_BUCKET;
    // if (!bucket) throw new Error("S3_BUCKET not configured");

    // const { qrItems, eventId } = event;
    // if (!qrItems || !Array.isArray(qrItems) || qrItems.length === 0) {
    //   return {
    //     statusCode: 400,
    //     body: JSON.stringify({ error: "qrItems must be a non-empty array", eventId }),
    //   };
    // }

//     // Prepare ZIP archive
//     const archive = archiver("zip", { zlib: { level: 9 } });
//     const pass = new PassThrough();
//     const chunks: Buffer[] = [];
//     const collectZipBuffer = new Promise<Buffer>((resolve, reject) => {
//       pass.on("data", (chunk) => chunks.push(chunk));
//       pass.on("end", () => resolve(Buffer.concat(chunks)));
//       pass.on("error", reject);
//     });
//     archive.pipe(pass);

//     // Process all QR codes in parallel
//     const results = await Promise.all(
//       qrItems.map(async (item: any) => {
//         try {
//           const guestId = item.guestId || Date.now().toString();
//           const bgColorHex = rgbToHex(item.bgColor || "255,255,255");
//           const centerColorHex = rgbToHex(item.centerColor || "0,0,0");
//           const edgeColorHex = rgbToHex(item.edgeColor || "0,0,0");

//           const svg = generateQrSvg(guestId, bgColorHex, centerColorHex, edgeColorHex);

//           const pngBuffer = await sharp(Buffer.from(svg))
//             .resize(512, 512, { fit: "contain" })
//             .png({ compressionLevel: 9, adaptiveFiltering: true })
//             .toBuffer();

//           const guestName = safe(item.guestName || "Guest");
//           const tableNo = safe(item.tableNo || "NoTable");
//           const outName = `${guestName}_Table-${tableNo}_${guestId}.png`;

//           return { pngBuffer, outName, success: true };
//         } catch (err: unknown) {
//           console.error("❌ Could not generate QR for item:", item, err);
//           return { item, success: false };
//         }
//       })
//     );

//     const addedFiles: string[] = [];
//     const missingFiles: any[] = [];

//     // Append all successful PNGs to the ZIP
//     for (const res of results) {
//       if (res.success && res.pngBuffer && res.outName) {
//         archive.append(res.pngBuffer, { name: res.outName });
//         addedFiles.push(res.outName);
//       } else if ("item" in res) {
//         missingFiles.push(res.item);
//       }
//     }

//     await archive.finalize();
//     const zipBuffer = await collectZipBuffer;

//     if (!zipBuffer.length || addedFiles.length === 0) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           error: "No QR code files were processed. ZIP not created.",
//           missingFiles,
//           eventId,
//         }),
//       };
//     }

//     // Upload ZIP to S3
//     const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
//     await s3.putObject({
//       Bucket: bucket,
//       Key: zipKey,
//       Body: zipBuffer,
//       ContentType: "application/zip",
//     }).promise();

//     const zipUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
//     console.log(`✅ ZIP uploaded: ${zipUrl}`);

//     return {
//       statusCode: 200,
//       body: JSON.stringify({
//         zipUrl,
//         eventId,
//         generatedAt: new Date().toISOString(),
//         numberOfFiles: addedFiles.length,
//         addedFiles,
//         missingFiles,
//       }),
//     };
//   } catch (err: unknown) {
//     console.error("❌ Error in Lambda:", err);
//     const message = err instanceof Error ? err.message : "Internal Server Error";
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ error: message }),
//     };
//   }
// };



// import AWS from "aws-sdk";
// import archiver from "archiver";
// import { PassThrough } from "stream";
// import sharp from "sharp";
// import { generateQrSvg } from "./generateQrSvg.js"; 

// const s3 = new AWS.S3();

// function safeName(str: string) {
//   return str ? str.replace(/[^a-zA-Z0-9._-]/g, "_") : "unknown";
// }

// export const handler = async (event:any) => {
//   try {
//       const bucket = process.env.S3_BUCKET;
//     if (!bucket) throw new Error("S3_BUCKET not configured");

//     const { qrItems, eventId } = event;
//     if (!qrItems || !Array.isArray(qrItems) || qrItems.length === 0) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({ error: "qrItems must be a non-empty array", eventId }),
//       };
//     }

//     const archive = archiver("zip", { zlib: { level: 9 } });
//     const zipStream = new PassThrough();
//     archive.pipe(zipStream);

//     const addedFiles: string[] = [];
//     const missingFiles: any[] = [];

//     // 🚀 Process QR codes in parallel
//     const results = await Promise.all(
//       qrItems.map(async (item, index) => {
//         try {
//           const { guestId, guestName, tableNo, others } = item;

//           // 1. Generate QR SVG with custom gradient
//           const svg = generateQrSvg(
//             guestId || `guest_${index}`,
//             item.qrCodeBgColor || "#FFFFFF",
//             item.qrCodeCenterColor || "#000000",
//             item.qrCodeEdgeColor || "#000000"
//           );

//           // 2. Convert SVG → PNG
//           const buffer = await sharp(Buffer.from(svg))
//             .png()
//             .toBuffer();

//           // 3. Safe filename
//           const filename = `qr-${safeName(guestName)}_${safeName(
//             tableNo
//           )}_${safeName(others)}_${guestId || index}.png`;

//           archive.append(buffer, { name: filename });
//           addedFiles.push(filename);
//         } catch (err) {
//           console.error("❌ Failed to process QR item:", item, err);
//           missingFiles.push(item);
//         }
//       })
//     );

//     await archive.finalize();

//     // Collect ZIP buffer
//     const chunks: Buffer[] = [];
//     for await (const chunk of zipStream) {
//       chunks.push(chunk);
//     }
//     const zipBuffer = Buffer.concat(chunks);

//     if (addedFiles.length === 0) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           message: "No QR codes processed, ZIP not created",
//           missingFiles,
//           eventId,
//         }),
//       };
//     }

//     // 🚀 Upload ZIP to S3
//     const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
//     await s3
//       .putObject({
//         Bucket: bucket,
//         Key: zipKey,
//         Body: zipBuffer,
//         ContentType: "application/zip",
//       })
//       .promise();

//     // 🚀 Public S3 URL
//     const zipUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
//     console.log(`✅ ZIP uploaded: ${zipUrl}`);

//     return {
//       statusCode: 200,
//       body: JSON.stringify({
//         zipUrl,
//         eventId,
//         generatedAt: new Date().toISOString(),
//         numberOfFiles: addedFiles.length,
//         addedFiles,
//         missingFiles,
//       }),
//     };
//   } catch (err: unknown) {
//     console.error("❌ Error in Lambda:", err);
//     const message = err instanceof Error ? err.message : "Internal Server Error";
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ error: message }),
//     };
//   }
// };


import AWS from "aws-sdk";
import archiver from "archiver";
import { PassThrough } from "stream";
import sharp from "sharp";
import { generateQrSvg } from "./generateQrSvg.js"; 
import { rgbToHex } from "./colorUtils.js"; // ✅ convert "255,255,255" → "#FFFFFF"

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
