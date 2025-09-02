"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromS3 = exports.uploadToS3 = void 0;
// utils/s3.ts
const client_s3_1 = require("@aws-sdk/client-s3");
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const uploadToS3 = async (buffer, key, contentType, options = {}) => {
    const { folder = '', acl = 'public-read', metadata = {} } = options;
    const fullKey = folder ? `${folder}/${key}` : key;
    await s3.send(new client_s3_1.PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fullKey,
        Body: buffer,
        ContentType: contentType,
        // ACL: acl,
        Metadata: metadata
    }));
    return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fullKey}`;
};
exports.uploadToS3 = uploadToS3;
const deleteFromS3 = async (key) => {
    await s3.send(new client_s3_1.DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key
    }));
};
exports.deleteFromS3 = deleteFromS3;
