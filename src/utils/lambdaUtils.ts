import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
import { lambda } from "./awsConfig";

export const invokeLambda = async (
  functionName: string,
  payload: any,
  asyncInvoke = false
): Promise<any> => {
  console.log("🚀 Invoking Lambda:", { functionName, payload, asyncInvoke });

  const command = new InvokeCommand({
    // FunctionName: "softinvites-backend-dev-app",
    FunctionName: functionName, 
    InvocationType: asyncInvoke ? "Event" as InvocationType : "RequestResponse" as InvocationType,
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  const response = await lambda.send(command);

  if (asyncInvoke) return { statusCode: 202, body: "{}" };

  const responsePayload = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "{}";

  console.log("✅ Lambda response:", responsePayload);
  return JSON.parse(responsePayload);
};



