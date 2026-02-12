import { LambdaClient } from "@aws-sdk/client-lambda";

const config = {
  region: process.env.AWS_REGION || "us-east-2",
};

export const lambda = new LambdaClient(config);
