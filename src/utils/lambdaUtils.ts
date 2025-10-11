// import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
// import { lambda } from "./awsConfig";

// export const invokeLambda = async (
//   functionName: string,
//   payload: any,
//   asyncInvoke = false
// ): Promise<any> => {
//   const params = {
//     FunctionName: functionName,
//     InvocationType: asyncInvoke ? "Event" as InvocationType : "RequestResponse" as InvocationType,
//     Payload: Buffer.from(JSON.stringify(payload)),
//   };

//   const command = new InvokeCommand(params);
//   const response = await lambda.send(command);

//   // If async, Lambda does not return a payload
//   if (asyncInvoke) {
//     return { statusCode: 202, body: "{}" };
//   }

//   // Otherwise parse normally
//   const responsePayload = response.Payload ? Buffer.from(response.Payload).toString() : "{}";
//   return JSON.parse(responsePayload);
// };



// import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
// import { lambda } from "./awsConfig";

// export const invokeLambda = async (
//   functionName: string,
//   payload: any,
//   asyncInvoke = false
// ): Promise<any> => {
//   console.log("🚀 Invoking Lambda:", { functionName, payload, asyncInvoke });

//   const command = new InvokeCommand({
//     // FunctionName: "softinvites-backend-dev-app",
//     FunctionName: functionName, 
//     InvocationType: asyncInvoke ? "Event" as InvocationType : "RequestResponse" as InvocationType,
//     Payload: Buffer.from(JSON.stringify(payload)),
//   });

//   const response = await lambda.send(command);

//   if (asyncInvoke) return { statusCode: 202, body: "{}" };

//   const responsePayload = response.Payload
//     ? new TextDecoder().decode(response.Payload)
//     : "{}";

//   console.log("✅ Lambda response:", responsePayload);
//   return JSON.parse(responsePayload);
// };


import { InvokeCommand, InvocationType } from "@aws-sdk/client-lambda";
import { lambda } from "./awsConfig";


export const invokeLambda = async (
  functionName: string,
  payload: any,
  asyncInvoke = false
): Promise<any> => {
  console.log("🚀 Invoking Lambda:", { functionName, payload, asyncInvoke });

  const command = new InvokeCommand({
    FunctionName: functionName,
    InvocationType: asyncInvoke ? "Event" : "RequestResponse",
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  try {
    const response = await lambda.send(command);

    if (asyncInvoke) {
      return { statusCode: 202 };
    }

    if (!response.Payload) {
      throw new Error("❌ No Payload returned from Lambda");
    }

    // Decode the payload
    const payloadString = new TextDecoder().decode(response.Payload);
    console.log("🧩 Raw Lambda Payload String:", payloadString);

    // Try to parse as JSON
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(payloadString);
    } catch (parseError) {
      console.error("❌ Failed to parse Lambda response as JSON:", parseError);
      throw new Error(`Lambda response is not valid JSON: ${payloadString}`);
    }

    // Handle Lambda function error
    if (parsedResponse.errorMessage) {
      console.error("❌ Lambda function error:", parsedResponse);
      throw new Error(parsedResponse.errorMessage);
    }

    // If it's an API Gateway-like response with body
    if (parsedResponse.body) {
      try {
        const bodyData = JSON.parse(parsedResponse.body);
        console.log("✅ Parsed Lambda Body:", bodyData);
        return bodyData;
      } catch (bodyError) {
        console.warn("⚠️ Body is not JSON, returning as-is:", parsedResponse.body);
        return { body: parsedResponse.body };
      }
    }

    // If it's a direct response from Lambda
    console.log("✅ Direct Lambda Response:", parsedResponse);
    return parsedResponse;

  } catch (error) {
    console.error("❌ Lambda invocation error:", error);
    throw error;
  }
};