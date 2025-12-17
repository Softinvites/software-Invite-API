import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";

const config = {
  region: process.env.AWS_REGION || "us-east-2",
};

export const s3 = new S3Client(config);
export const lambda = new LambdaClient(config);