import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";
// import { defaultProvider } from "@aws-sdk/credential-provider-node";

const config = {
  region: process.env.AWS_REGION || "us-east-2",
  // credentials: defaultProvider(),
};

export const s3 = new S3Client(config);
export const lambda = new LambdaClient(config);
