import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
import { lambda } from "./awsConfig";

export const invokeLambda = async (
  functionName: string,
  payload: any,
  asyncInvoke = false
): Promise<any> => {
  const params = {
    FunctionName: functionName,
    InvocationType: asyncInvoke ? "Event" as InvocationType : "RequestResponse" as InvocationType,
    Payload: Buffer.from(JSON.stringify(payload)),
  };

  const command = new InvokeCommand(params);
  const response = await lambda.send(command);

  // If async, Lambda does not return a payload
  if (asyncInvoke) {
    return { statusCode: 202, body: "{}" };
  }

  // Otherwise parse normally
  const responsePayload = response.Payload ? Buffer.from(response.Payload).toString() : "{}";
  return JSON.parse(responsePayload);
};
