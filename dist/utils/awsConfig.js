"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lambda = exports.s3 = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const config = {
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
};
exports.s3 = new client_s3_1.S3Client(config);
exports.lambda = new client_lambda_1.LambdaClient(config);
