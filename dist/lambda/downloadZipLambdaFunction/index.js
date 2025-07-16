"use strict";
// import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
// import archiver from "archiver";
// import { PassThrough } from "stream";
// import { Readable } from "stream";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
// const s3 = new S3Client({ region: process.env.AWS_REGION });
// export const handler = async (event: { qrPaths: string[]; eventId: string }) => {
//   const { qrPaths, eventId } = event;
//   if (!qrPaths || !Array.isArray(qrPaths) || qrPaths.length === 0) {
//     return {
//       statusCode: 400,
//       body: JSON.stringify({
//         message: "qrPaths must be a non-empty array",
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
//   for (const key of qrPaths) {
//     try {
//       const { Body } = await s3.send(
//         new GetObjectCommand({
//           Bucket: process.env.S3_BUCKET!,
//           Key: key,
//         })
//       );
//       if (Body) {
//         archive.append(Body as Readable, {
//           name: key.split("/").pop() || `qr_${Date.now()}.svg`,
//           date: new Date(),
//         });
//       }
//     } catch (err) {
//       console.error(`❌ Could not fetch S3 object: ${key}`, err);
//       // Skip this file
//     }
//   }
//   await archive.finalize();
//   const zipBuffer = await collectZipBuffer;
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
//       numberOfFiles: qrPaths.length,
//     }),
//   };
// };
const client_s3_1 = require("@aws-sdk/client-s3");
const archiver_1 = __importDefault(require("archiver"));
const stream_1 = require("stream");
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const handler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    const { qrPaths, eventId } = event;
    if (!qrPaths || !Array.isArray(qrPaths) || qrPaths.length === 0) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: "qrPaths must be a non-empty array",
                eventId,
            }),
        };
    }
    const archive = (0, archiver_1.default)("zip", { zlib: { level: 9 } });
    const pass = new stream_1.PassThrough();
    const chunks = [];
    const collectZipBuffer = new Promise((resolve, reject) => {
        pass.on("data", (chunk) => chunks.push(chunk));
        pass.on("end", () => resolve(Buffer.concat(chunks)));
        pass.on("error", reject);
    });
    archive.pipe(pass);
    const addedFiles = [];
    const missingFiles = [];
    for (const key of qrPaths) {
        try {
            const { Body } = yield s3.send(new client_s3_1.GetObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: key,
            }));
            if (Body) {
                archive.append(Body, {
                    name: key.split("/").pop() || `qr_${Date.now()}.svg`,
                    date: new Date(),
                });
                addedFiles.push(key);
            }
        }
        catch (err) {
            console.error(`❌ Could not fetch S3 object: ${key}`, err);
            missingFiles.push(key);
        }
    }
    yield archive.finalize();
    const zipBuffer = yield collectZipBuffer;
    if (!zipBuffer.length || addedFiles.length === 0) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: "No QR code files were found in S3. ZIP not created.",
                eventId,
                missingFiles,
            }),
        };
    }
    const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
    yield s3.send(new client_s3_1.PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: zipKey,
        Body: zipBuffer,
        ContentType: "application/zip",
        ACL: "public-read",
    }));
    const zipUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
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
});
exports.handler = handler;
