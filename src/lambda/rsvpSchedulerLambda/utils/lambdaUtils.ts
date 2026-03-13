import { InvokeCommand, InvocationType, LambdaClient } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-2",
});

const extractLambdaError = (response: any, parsedPayload: any) => {
  if (response?.FunctionError) {
    return parsedPayload?.errorMessage || parsedPayload?.message || response.FunctionError;
  }

  if (
    parsedPayload &&
    typeof parsedPayload.statusCode === "number" &&
    parsedPayload.statusCode >= 400
  ) {
    let body: any = parsedPayload.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // keep original string
      }
    }
    return (
      body?.error ||
      body?.message ||
      parsedPayload?.error ||
      parsedPayload?.message ||
      `Invoked lambda returned status ${parsedPayload.statusCode}`
    );
  }

  if (parsedPayload?.errorMessage) {
    return parsedPayload.errorMessage;
  }

  return null;
};

export const invokeLambda = async (
  functionName: string,
  payload: any,
  asyncInvoke = false,
) => {
  const command = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: asyncInvoke
      ? InvocationType.Event
      : InvocationType.RequestResponse,
    Payload: Buffer.from(JSON.stringify(payload)),
  });
  const response = await lambda.send(command);
  if (asyncInvoke) {
    return {
      statusCode: response.StatusCode ?? 202,
      requestId: response.$metadata?.requestId || null,
    };
  }
  if (!response.Payload) return {};

  const raw = Buffer.from(response.Payload).toString().trim();
  if (!raw) return {};

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Lambda invoke failed for ${functionName}: ${raw}`);
  }

  const errorMessage = extractLambdaError(response, parsed);
  if (errorMessage) {
    throw new Error(`Lambda invoke failed for ${functionName}: ${String(errorMessage)}`);
  }

  return parsed;
};
