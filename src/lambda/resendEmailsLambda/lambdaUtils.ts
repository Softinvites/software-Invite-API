import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
import { lambda } from "./awsConfig.js";

export const invokeLambda = async (functionName: string, payload: any, asyncInvoke: boolean = false ) => {
  const params = {
    FunctionName: functionName,
    InvocationType: asyncInvoke ? InvocationType.Event : InvocationType.RequestResponse,
    Payload: Buffer.from(JSON.stringify(payload)),
  };

  const command = new InvokeCommand(params);
  const response = await lambda.send(command);

  if (!response.Payload) {
    return {}; // nothing to parse
  }

  const responseStr = Buffer.from(response.Payload).toString().trim();

  if (!responseStr) {
    return {}; // avoid JSON.parse("") crash
  }

  try {
    return JSON.parse(responseStr);
  } catch (err) {
    console.error("Failed to parse Lambda response:", responseStr);
    throw err;
  }
};