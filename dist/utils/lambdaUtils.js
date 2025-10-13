"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeLambda = void 0;
const client_lambda_1 = require("@aws-sdk/client-lambda");
const awsConfig_1 = require("./awsConfig");
const invokeLambda = async (functionName, payload, asyncInvoke = false) => {
    console.log("🚀 Invoking Lambda:", { functionName, payload, asyncInvoke });
    const command = new client_lambda_1.InvokeCommand({
        // FunctionName: "softinvites-backend-dev-app",
        FunctionName: functionName,
        InvocationType: asyncInvoke ? "Event" : "RequestResponse",
        Payload: Buffer.from(JSON.stringify(payload)),
    });
    const response = await awsConfig_1.lambda.send(command);
    if (asyncInvoke)
        return { statusCode: 202, body: "{}" };
    const responsePayload = response.Payload
        ? new TextDecoder().decode(response.Payload)
        : "{}";
    console.log("✅ Lambda response:", responsePayload);
    return JSON.parse(responsePayload);
};
exports.invokeLambda = invokeLambda;
