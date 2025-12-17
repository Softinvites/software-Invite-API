import AWS from "aws-sdk";
import archiver from "archiver";
import { PassThrough } from "stream";
import sharp from "sharp";
const s3 = new AWS.S3();
/**
 * safeName
 */
function safeName(str) {
    return str ? String(str).replace(/[^a-zA-Z0-9._-]/g, "_") : "unknown";
}
/**
 * streamToBuffer
 */
async function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", (err) => reject(err));
    });
}
/**
 * ZIP LAMBDA HANDLER
 */
export const handler = async (event) => {
    try {
        const bucket = process.env.S3_BUCKET;
        if (!bucket)
            throw new Error("S3_BUCKET not configured");
        const { qrItems, eventId } = event;
        if (!qrItems || !Array.isArray(qrItems) || qrItems.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "qrItems must be a non-empty array", eventId }),
            };
        }
        const CONCURRENCY_LIMIT = Math.max(1, parseInt(process.env.CONCURRENCY_LIMIT || "10", 10));
        const makePublic = (process.env.S3_UPLOAD_PUBLIC || "false").toLowerCase() === "true";
        const archive = archiver("zip", { zlib: { level: 9 } });
        const zipStream = new PassThrough();
        archive.pipe(zipStream);
        const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
        const uploadParams = {
            Bucket: bucket,
            Key: zipKey,
            Body: zipStream,
            ContentType: "application/zip",
        };
        if (makePublic)
            uploadParams.ACL = "public-read";
        const uploadPromise = s3.upload(uploadParams).promise();
        const streamErrorPromise = new Promise((_, reject) => {
            archive.on("error", reject);
            zipStream.on("error", reject);
        });
        const addedFiles = [];
        const missingFiles = [];
        for (let i = 0; i < qrItems.length; i += CONCURRENCY_LIMIT) {
            const slice = qrItems.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(slice.map(async (item, idx) => {
                const localIndex = i + idx;
                try {
                    let { key, guestId, guestName, tableNo, others } = item;
                    if (!guestId) {
                        missingFiles.push({ item, error: "Missing guestId" });
                        return;
                    }
                    // ✅ 1. Always decode URL-encoded keys (%20 etc)
                    if (key) {
                        key = decodeURIComponent(key);
                    }
                    // ✅ 2. Fallback to the PNG path if SVG is missing
                    const fallbackPngKey = `qr_codes/png/${eventId}/${guestId}.png`;
                    let s3Obj;
                    try {
                        if (key) {
                            s3Obj = await s3.getObject({ Bucket: bucket, Key: key }).promise();
                        }
                    }
                    catch {
                        // ✅ Fallback to PNG if SVG is missing
                        try {
                            s3Obj = await s3.getObject({ Bucket: bucket, Key: fallbackPngKey }).promise();
                            key = fallbackPngKey;
                        }
                        catch (fallbackErr) {
                            missingFiles.push({
                                item,
                                error: "Neither SVG nor PNG exists in S3",
                                tried: [key, fallbackPngKey],
                            });
                            return;
                        }
                    }
                    if (!s3Obj || !s3Obj.Body) {
                        missingFiles.push({ item, error: "Empty S3 object body" });
                        return;
                    }
                    const bodyBuffer = Buffer.isBuffer(s3Obj.Body)
                        ? s3Obj.Body
                        : await streamToBuffer(s3Obj.Body);
                    // ✅ If it's already PNG, don’t reconvert
                    const isPng = key.endsWith(".png");
                    const pngBuffer = isPng
                        ? bodyBuffer
                        : await sharp(bodyBuffer).png().toBuffer();
                    const filename = `qr-${safeName(guestName)}_${safeName(tableNo)}_${safeName(others)}_${guestId || localIndex}.png`;
                    archive.append(pngBuffer, { name: filename });
                    addedFiles.push(filename);
                }
                catch (err) {
                    console.error("❌ Failed to process QR item:", item, err);
                    missingFiles.push({
                        item,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }));
        }
        const finalizePromise = archive.finalize();
        await Promise.race([
            Promise.all([uploadPromise, finalizePromise]),
            streamErrorPromise,
        ]);
        await uploadPromise;
        if (addedFiles.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "No QR codes processed",
                    missingFiles,
                    eventId,
                }),
            };
        }
        const zipUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
        return {
            statusCode: 200,
            body: JSON.stringify({
                zipDownloadLink: zipUrl,
                eventId,
                generatedAt: new Date().toISOString(),
                numberOfFiles: addedFiles.length,
                missingFiles,
            }),
        };
    }
    catch (err) {
        console.error("❌ Error in ZIP Lambda:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: err instanceof Error ? err.message : "Internal Server Error",
            }),
        };
    }
};
