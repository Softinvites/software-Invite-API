"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromS3 = exports.uploadToS3 = void 0;
// utils/s3.ts
const client_s3_1 = require("@aws-sdk/client-s3");
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const uploadToS3 = (buffer_1, key_1, contentType_1, ...args_1) => __awaiter(void 0, [buffer_1, key_1, contentType_1, ...args_1], void 0, function* (buffer, key, contentType, options = {}) {
    const { folder = '', acl = 'public-read', metadata = {} } = options;
    const fullKey = folder ? `${folder}/${key}` : key;
    yield s3.send(new client_s3_1.PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fullKey,
        Body: buffer,
        ContentType: contentType,
        // ACL: acl,
        Metadata: metadata
    }));
    return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fullKey}`;
});
exports.uploadToS3 = uploadToS3;
const deleteFromS3 = (key) => __awaiter(void 0, void 0, void 0, function* () {
    yield s3.send(new client_s3_1.DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key
    }));
});
exports.deleteFromS3 = deleteFromS3;
