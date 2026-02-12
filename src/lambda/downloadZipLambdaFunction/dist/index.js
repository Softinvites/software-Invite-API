import AWS from "aws-sdk";
import archiver from "archiver";
import { PassThrough, Readable } from "stream";
const s3 = new AWS.S3();
/* ------------------------------ */
/* 🔧 HELPERS */
/* ------------------------------ */
function safeName(str) {
    return str ? String(str).replace(/[^a-zA-Z0-9._-]/g, "_") : "unknown";
}
function isS3Url(url) {
    return url.hostname.includes(".s3.") || url.hostname.endsWith("amazonaws.com");
}
/* ------------------------------ */
/* 📦 ZIP LAMBDA HANDLER */
/* ------------------------------ */
export const handler = async (event) => {
    try {
        const bucket = process.env.S3_BUCKET;
        if (!bucket)
            throw new Error("S3_BUCKET not configured");
        const { qrItems, eventId } = event;
        if (!Array.isArray(qrItems) || qrItems.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "qrItems must be a non-empty array" }),
            };
        }
        const CONCURRENCY_LIMIT = Math.max(1, Number(process.env.CONCURRENCY_LIMIT || 15));
        /* ------------------------------ */
        /* 🧵 CREATE ZIP STREAM */
        /* ------------------------------ */
        const archive = archiver("zip", { zlib: { level: 6 } }); // lower CPU
        const zipStream = new PassThrough();
        archive.pipe(zipStream);
        const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
        const uploadPromise = s3
            .upload({
            Bucket: bucket,
            Key: zipKey,
            Body: zipStream,
            ContentType: "application/zip",
        })
            .promise();
        const streamErrorPromise = new Promise((_, reject) => {
            archive.on("error", reject);
            zipStream.on("error", reject);
        });
        const addedFiles = [];
        const missingFiles = [];
        /* ------------------------------ */
        /* 🚀 STREAM PNG FILES INTO ZIP */
        /* ------------------------------ */
        for (let i = 0; i < qrItems.length; i += CONCURRENCY_LIMIT) {
            const batch = qrItems.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(batch.map(async (item) => {
                const { guestId, guestName, tableNo, others } = item;
                if (!guestId) {
                    missingFiles.push({ item, error: "Missing guestId" });
                    return;
                }
                if (!item.pngUrl || typeof item.pngUrl !== "string") {
                    missingFiles.push({ item, error: "Missing pngUrl" });
                    return;
                }
                const filename = `qr-${safeName(guestName)}_${safeName(tableNo)}_${safeName(others)}_${guestId}.png`;
                const tryFetch = async () => {
                    const response = await fetch(item.pngUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch pngUrl (${response.status})`);
                    }
                    if (!response.body) {
                        throw new Error("Empty pngUrl response body");
                    }
                    const nodeStream = Readable.fromWeb(response.body);
                    archive.append(nodeStream, { name: filename });
                    addedFiles.push(filename);
                };
                const tryS3 = async () => {
                    const url = new URL(item.pngUrl);
                    if (!isS3Url(url)) {
                        throw new Error("pngUrl is not an S3 URL");
                    }
                    const key = url.pathname.startsWith("/")
                        ? url.pathname.slice(1)
                        : url.pathname;
                    const s3Stream = s3
                        .getObject({ Bucket: bucket, Key: key })
                        .createReadStream();
                    archive.append(s3Stream, { name: filename });
                    addedFiles.push(filename);
                };
                try {
                    await tryFetch();
                }
                catch (err) {
                    const message = err?.message || String(err);
                    if (message.includes("(403)") || message.includes("403")) {
                        try {
                            await tryS3();
                        }
                        catch (s3Err) {
                            console.error("❌ PNG fetch failed (403) and S3 fallback failed:", s3Err);
                            missingFiles.push({
                                item,
                                error: "PNG fetch failed (403) and S3 fallback failed",
                            });
                        }
                        return;
                    }
                    console.error("❌ PNG fetch failed:", item.pngUrl, err);
                    missingFiles.push({
                        item,
                        error: message,
                    });
                }
            }));
        }
        /* ------------------------------ */
        /* ✅ FINALIZE ZIP */
        /* ------------------------------ */
        const finalizePromise = archive.finalize();
        await Promise.race([
            Promise.all([uploadPromise, finalizePromise]),
            streamErrorPromise,
        ]);
        await uploadPromise;
        if (!addedFiles.length) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "No PNG files added to ZIP",
                    missingFiles,
                }),
            };
        }
        const zipUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
        return {
            statusCode: 200,
            body: JSON.stringify({
                eventId,
                zipDownloadLink: zipUrl,
                generatedAt: new Date().toISOString(),
                numberOfFiles: addedFiles.length,
                missingFiles,
            }),
        };
    }
    catch (err) {
        console.error("❌ ZIP Lambda Error:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: err.message || "Internal Server Error",
            }),
        };
    }
};
