import { LambdaClient } from "@aws-sdk/client-lambda";

export const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-2",
});