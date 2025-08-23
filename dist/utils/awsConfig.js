"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lambda = exports.s3 = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const credential_provider_node_1 = require("@aws-sdk/credential-provider-node");
const config = {
    region: process.env.AWS_REGION || "us-east-2",
    credentials: (0, credential_provider_node_1.defaultProvider)(),
};
exports.s3 = new client_s3_1.S3Client(config);
exports.lambda = new client_lambda_1.LambdaClient(config);
