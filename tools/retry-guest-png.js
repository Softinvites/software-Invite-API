"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_s3_1 = require("@aws-sdk/client-s3");
dotenv_1.default.config();
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/softinvites';
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';
const S3_BUCKET = process.env.S3_BUCKET;
const PNG_CONVERT_LAMBDA = process.env.PNG_CONVERT_LAMBDA;
if (!S3_BUCKET) {
    console.error('Missing S3_BUCKET env var');
    process.exit(1);
}
if (!PNG_CONVERT_LAMBDA) {
    console.error('Missing PNG_CONVERT_LAMBDA env var');
    process.exit(1);
}
const guestmodel_1 = require("../src/models/guestmodel");
const lambda = new client_lambda_1.LambdaClient({ region: AWS_REGION });
const s3 = new client_s3_1.S3Client({ region: AWS_REGION });
function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--guestId' && args[i + 1]) {
            out.guestId = args[i + 1];
            i++;
        }
    }
    return out;
}
async function headExists(key) {
    try {
        await s3.send(new client_s3_1.HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return true;
    }
    catch (e) {
        if (e?.$metadata && e.$metadata.httpStatusCode === 404)
            return false;
        return false;
    }
}
async function invokeWithRetry(guestId, eventId) {
    const payload = { guestId, eventId };
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const cmd = new client_lambda_1.InvokeCommand({
                FunctionName: PNG_CONVERT_LAMBDA,
                InvocationType: 'RequestResponse',
                Payload: Buffer.from(JSON.stringify(payload)),
            });
            const res = await lambda.send(cmd);
            if (res.Payload) {
                const bodyStr = Buffer.from(res.Payload).toString();
                try {
                    const parsed = JSON.parse(bodyStr);
                    if (parsed && parsed.body) {
                        try {
                            const inner = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
                            if (inner && inner.pngUrl)
                                return { pngUrl: inner.pngUrl, raw: bodyStr };
                        }
                        catch (e) {
                            // ignore
                        }
                    }
                    if (parsed && parsed.pngUrl)
                        return { pngUrl: parsed.pngUrl, raw: bodyStr };
                    return { pngUrl: null, raw: bodyStr };
                }
                catch (e) {
                    return { pngUrl: null, raw: bodyStr };
                }
            }
            return { pngUrl: null, raw: null };
        }
        catch (e) {
            console.warn(`Attempt ${attempt} failed:`, e?.name || e?.message || e);
            // Rate limit handling: backoff
            if (attempt < maxAttempts) {
                const delay = 1000 * Math.pow(2, attempt);
                console.log(`Waiting ${delay}ms before retrying...`);
                await new Promise((res) => setTimeout(res, delay));
                continue;
            }
            throw e;
        }
    }
    return { pngUrl: null, raw: null };
}
async function run() {
    const { guestId } = parseArgs();
    if (!guestId) {
        console.error('Usage: --guestId <id>');
        process.exit(2);
    }
    await mongoose_1.default.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined });
    console.log('Connected to DB');
    const guest = await guestmodel_1.Guest.findById(guestId);
    if (!guest) {
        console.error('Guest not found:', guestId);
        process.exit(3);
    }
    const eventId = guest.eventId?.toString();
    if (!eventId) {
        console.error('Guest has no eventId');
        process.exit(4);
    }
    console.log('Invoking PNG lambda for guest', guestId, 'event', eventId);
    try {
        const { pngUrl, raw } = await invokeWithRetry(guestId, eventId);
        if (pngUrl) {
            console.log('Lambda returned pngUrl:', pngUrl);
            await guestmodel_1.Guest.findByIdAndUpdate(guestId, { pngUrl });
            console.log('Guest updated with pngUrl');
            await mongoose_1.default.disconnect();
            process.exit(0);
        }
        // Fallback: check S3
        const key = `qr_codes/png/${eventId}/${guestId}.png`;
        const exists = await headExists(key);
        if (exists) {
            const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
            console.log('Found object in S3 at', url, '- updating guest');
            await guestmodel_1.Guest.findByIdAndUpdate(guestId, { pngUrl: url });
            await mongoose_1.default.disconnect();
            process.exit(0);
        }
        console.error('PNG not produced. Lambda raw response:', raw);
        await mongoose_1.default.disconnect();
        process.exit(5);
    }
    catch (e) {
        console.error('Invocation failed:', e);
        await mongoose_1.default.disconnect();
        process.exit(1);
    }
}
run().catch((e) => {
    console.error(e);
    process.exit(1);
});
