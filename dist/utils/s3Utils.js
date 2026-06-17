"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPresignedUploadUrl = exports.buildS3PublicUrl = exports.deleteFromS3 = exports.uploadToS3 = void 0;
// utils/s3.ts
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const uploadToS3 = async (buffer, key, contentType, options = {}) => {
    const { folder = '', acl = 'public-read', metadata = {} } = options;
    const fullKey = folder ? `${folder}/${key}` : key;
    await s3.send(new client_s3_1.PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fullKey,
        Body: buffer,
        ContentType: contentType,
        // ACL: acl, — bucket uses BucketOwnerEnforced; public access via bucket policy
        Metadata: metadata
    }));
    return (0, exports.buildS3PublicUrl)(fullKey);
};
exports.uploadToS3 = uploadToS3;
const deleteFromS3 = async (key) => {
    await s3.send(new client_s3_1.DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key
    }));
};
exports.deleteFromS3 = deleteFromS3;
const buildS3PublicUrl = (key) => {
    const normalizedKey = String(key || '').replace(/^\/+/, '');
    return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${normalizedKey}`;
};
exports.buildS3PublicUrl = buildS3PublicUrl;
const createPresignedUploadUrl = async (key, contentType, expiresIn = 900) => {
    const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3, new client_s3_1.PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        ContentType: contentType,
    }), { expiresIn });
    return {
        uploadUrl,
        fileUrl: (0, exports.buildS3PublicUrl)(key),
        key,
    };
};
exports.createPresignedUploadUrl = createPresignedUploadUrl;
