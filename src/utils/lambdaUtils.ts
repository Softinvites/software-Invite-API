import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
import { lambda } from "./awsConfig";

export const invokeLambda = async (functionName: string, payload: any, asyncInvoke: boolean = false ) => {
  const params = {
    FunctionName: functionName,
//  InvocationType: "RequestResponse" as InvocationType, // 👈 fix
     InvocationType: asyncInvoke ? InvocationType.Event : InvocationType.RequestResponse,
    Payload: Buffer.from(JSON.stringify(payload)), 
  };

  const command = new InvokeCommand(params);
  const response = await lambda.send(command);

  // response.Payload is Uint8Array | undefined, so convert to string
  const responsePayload = response.Payload
    ? Buffer.from(response.Payload).toString()
    : "{}";

  return JSON.parse(responsePayload);
};
