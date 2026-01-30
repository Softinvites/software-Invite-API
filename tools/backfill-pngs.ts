#!/usr/bin/env ts-node
import mongoose from "mongoose";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGO_URL ||
  "mongodb://localhost:27017/softinvites";
const S3_BUCKET = process.env.S3_BUCKET;
const AWS_REGION = process.env.AWS_REGION || "us-east-2";
const PNG_CONVERT_LAMBDA = process.env.PNG_CONVERT_LAMBDA;

if (!S3_BUCKET) {
  console.error("Missing S3_BUCKET env var");
  process.exit(1);
}

// Import Guest and Event models
import { Guest } from "../src/models/guestmodel";
import { Event } from "../src/models/eventmodel";

const s3 = new S3Client({ region: AWS_REGION });
const lambda = new LambdaClient({ region: AWS_REGION });

type Opts = {
  eventId?: string;
  dryRun?: boolean;
  generateMissing?: boolean;
};

async function ensureDb() {
  await mongoose.connect(MONGO_URI, {
    dbName: process.env.MONGO_DB || undefined,
  });
}

async function headExists(key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET!, Key: key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata && err.$metadata.httpStatusCode === 404) return false;
    // Some SDKs throw 404 as  NotFound; treat any not-200 as missing
    return false;
  }
}

async function invokePngLambda(guestId: string, eventId: string) {
  if (!PNG_CONVERT_LAMBDA) throw new Error("PNG_CONVERT_LAMBDA not configured");
  const payload = { guestId, eventId };
  const cmd = new InvokeCommand({
    FunctionName: PNG_CONVERT_LAMBDA,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify(payload)),
  });
  const res = await lambda.send(cmd);
  // Parse Lambda response robustly to support both direct JSON and API-Gateway style
  if (res.Payload) {
    const bodyStr = Buffer.from(res.Payload as any).toString();
    try {
      const parsed = JSON.parse(bodyStr);
      // API Gateway proxied response: { statusCode, body: "{...}" }
      if (parsed && parsed.body) {
        try {
          const inner =
            typeof parsed.body === "string"
              ? JSON.parse(parsed.body)
              : parsed.body;
          if (inner && inner.pngUrl) return inner.pngUrl;
        } catch (e) {
          // ignore inner parse errors
        }
      }
      // Direct response: { pngUrl }
      if (parsed && parsed.pngUrl) return parsed.pngUrl;
      // If payload is present but no pngUrl, log it for debugging
      console.debug("PNG lambda returned payload without pngUrl:", bodyStr);
    } catch (e) {
      // Not JSON — ignore
      console.debug("PNG lambda returned non-JSON payload:", bodyStr);
    }
  }

  // Fallback: check S3 directly in case the lambda uploaded the PNG but didn't return a URL
  try {
    const key = `qr_codes/png/${eventId}/${guestId}.png`;
    const exists = await headExists(key);
    if (exists) {
      return `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
    }
  } catch (e) {
    console.warn("Error checking S3 after lambda invocation:", e);
  }

  return null;
}

async function backfill(opts: Opts) {
  await ensureDb();
  console.log("Connected to DB");

  const filter: any = {};
  if (opts.eventId) filter.eventId = opts.eventId;

  // Use paginated batches to avoid cursor timeouts on Atlas tiers that disallow noCursorTimeout.
  const batchSize = 200;
  let lastId: any = null;
  let total = 0;
  let found = 0;
  let missing = 0;
  let updated = 0;

  while (true) {
    const q: any = { ...filter };
    if (lastId) q._id = { $gt: lastId };
    const batch = await Guest.find(q).sort({ _id: 1 }).limit(batchSize).lean();
    if (batch.length === 0) break;

    for (const guest of batch) {
      total++;
      const id = guest._id.toString();
      const eventId = opts.eventId || guest.eventId?.toString();
      if (!eventId) {
        console.warn(`Guest ${id} has no eventId, skipping`);
        continue;
      }

      // Load event and skip if expired
      const eventDoc = await Event.findById(eventId).lean();
      if (!eventDoc) {
        console.warn(`Event ${eventId} not found for guest ${id}, skipping`);
        continue;
      }
      // Determine expiration: use same logic as Event model (2 days after event date)
      const eventDate = new Date(eventDoc.date);
      const expirationDate = new Date(
        eventDate.getTime() + 2 * 24 * 60 * 60 * 1000
      );
      const now = new Date();
      if (now > expirationDate) {
        // Event expired — skip processing this guest
        continue;
      }

      const key = `qr_codes/png/${eventId}/${id}.png`;
      const exists = await headExists(key);
      if (exists) {
        found++;
        const pngUrl = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
        if (!opts.dryRun) {
          if (guest.pngUrl !== pngUrl) {
            await Guest.findByIdAndUpdate(guest._id, { pngUrl });
            updated++;
          }
        }
      } else {
        missing++;
        if (opts.generateMissing) {
          try {
            const pngUrl = await invokePngLambda(id, eventId);
            if (pngUrl) {
              if (!opts.dryRun) {
                await Guest.findByIdAndUpdate(guest._id, { pngUrl });
                updated++;
              }
              found++;
              missing--;
            }
          } catch (e) {
            console.error(`PNG generation failed for ${id}:`, e);
          }
        }
      }

      if (total % 100 === 0) {
        console.log(
          `Processed ${total} guests — found: ${found}, missing: ${missing}, updated: ${updated}`
        );
      }
      lastId = guest._id;
    }
  }

  console.log(
    `Done. Processed ${total} guests — found: ${found}, missing: ${missing}, updated: ${updated}`
  );
  await mongoose.disconnect();
}

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const opts: Opts = { dryRun: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--eventId" && args[i + 1]) {
      opts.eventId = args[i + 1];
      i++;
    } else if (a === "--apply") {
      opts.dryRun = false;
    } else if (a === "--generate") {
      opts.generateMissing = true;
    }
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs();
  console.log("Backfill PNGs with options:", opts);
  backfill(opts)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
