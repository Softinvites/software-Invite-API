import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import archiver from "archiver";
import { PassThrough, Readable } from "stream";

const s3 = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event: { qrPaths: string[]; eventId: string }) => {
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

  const archive = archiver("zip", { zlib: { level: 9 } });
  const pass = new PassThrough();
  const chunks: Buffer[] = [];

  const collectZipBuffer = new Promise<Buffer>((resolve, reject) => {
    pass.on("data", (chunk) => chunks.push(chunk));
    pass.on("end", () => resolve(Buffer.concat(chunks)));
    pass.on("error", reject);
  });

  archive.pipe(pass);

  const addedFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const key of qrPaths) {
    try {
      const { Body } = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: key,
        })
      );

      if (Body) {
        archive.append(Body as Readable, {
          name: key.split("/").pop() || `qr_${Date.now()}.svg`,
          date: new Date(),
        });
        addedFiles.push(key);
      }
    } catch (err) {
      console.error(`❌ Could not fetch S3 object: ${key}`, err);
      missingFiles.push(key);
    }
  }

  await archive.finalize();
  const zipBuffer = await collectZipBuffer;

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

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: zipKey,
      Body: zipBuffer,
      ContentType: "application/zip",
      ACL: "public-read",
    })
  );

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
};
