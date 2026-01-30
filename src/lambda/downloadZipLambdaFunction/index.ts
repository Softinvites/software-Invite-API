import AWS from "aws-sdk";
import archiver from "archiver";
import { PassThrough } from "stream";

const s3 = new AWS.S3();

/* ------------------------------ */
/* 🔧 HELPERS */
/* ------------------------------ */

function safeName(str?: string) {
  return str ? String(str).replace(/[^a-zA-Z0-9._-]/g, "_") : "unknown";
}

/* ------------------------------ */
/* 📦 ZIP LAMBDA HANDLER */
/* ------------------------------ */

export const handler = async (event: any) => {
  try {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET not configured");

    const { qrItems, eventId } = event;
    if (!Array.isArray(qrItems) || qrItems.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "qrItems must be a non-empty array" }),
      };
    }

    const CONCURRENCY_LIMIT = Math.max(
      1,
      Number(process.env.CONCURRENCY_LIMIT || 15)
    );

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

    const streamErrorPromise = new Promise<void>((_, reject) => {
      archive.on("error", reject);
      zipStream.on("error", reject);
    });

    const addedFiles: string[] = [];
    const missingFiles: any[] = [];

    /* ------------------------------ */
    /* 🚀 STREAM PNG FILES INTO ZIP */
    /* ------------------------------ */

    for (let i = 0; i < qrItems.length; i += CONCURRENCY_LIMIT) {
      const batch = qrItems.slice(i, i + CONCURRENCY_LIMIT);

      await Promise.all(
        batch.map(async (item) => {
          const { guestId, guestName, tableNo, others } = item;

          if (!guestId) {
            missingFiles.push({ item, error: "Missing guestId" });
            return;
          }

          // Prefer pngUrl provided on the guest (pre-generated). Otherwise fall back
          // to the conventional S3 key `qr_codes/png/{eventId}/{guestId}.png`.
          let pngKey = `qr_codes/png/${eventId}/${guestId}.png`;
          if (item.pngUrl && typeof item.pngUrl === 'string') {
            try {
              const url = new URL(item.pngUrl);
              pngKey = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
            } catch (e) {
              // ignore parsing error and use default key
            }
          }

          try {
            const s3Stream = s3
              .getObject({ Bucket: bucket, Key: pngKey })
              .createReadStream();

            const filename = `qr-${safeName(guestName)}_${safeName(
              tableNo
            )}_${safeName(others)}_${guestId}.png`;

            archive.append(s3Stream, { name: filename });
            addedFiles.push(filename);
          } catch (err: any) {
            console.error("❌ Missing PNG:", pngKey, err);
            missingFiles.push({
              guestId,
              error: "PNG not found in S3",
              key: pngKey,
            });
          }
        })
      );
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
  } catch (err: any) {
    console.error("❌ ZIP Lambda Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Internal Server Error",
      }),
    };
  }
};
