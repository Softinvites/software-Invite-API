"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeLambda = void 0;
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_lambda_2 = require("@aws-sdk/client-lambda");
const lambda = new client_lambda_2.LambdaClient({
    region: process.env.AWS_REGION || "us-east-2",
});
const extractLambdaError = (response, parsedPayload) => {
    if (response?.FunctionError) {
        return parsedPayload?.errorMessage || parsedPayload?.message || response.FunctionError;
    }
    if (parsedPayload &&
        typeof parsedPayload.statusCode === "number" &&
        parsedPayload.statusCode >= 400) {
        let body = parsedPayload.body;
        if (typeof body === "string") {
            try {
                body = JSON.parse(body);
            }
            catch {
                // keep original string
            }
        }
        return (body?.error ||
            body?.message ||
            parsedPayload?.error ||
            parsedPayload?.message ||
            `Invoked lambda returned status ${parsedPayload.statusCode}`);
    }
    if (parsedPayload?.errorMessage) {
        return parsedPayload.errorMessage;
    }
    return null;
};
const invokeLambda = async (functionName, payload, asyncInvoke = false) => {
    const params = {
        FunctionName: functionName,
        InvocationType: asyncInvoke ? client_lambda_1.InvocationType.Event : client_lambda_1.InvocationType.RequestResponse,
        Payload: Buffer.from(JSON.stringify(payload)),
    };
    const command = new client_lambda_1.InvokeCommand(params);
    const response = await lambda.send(command);
    if (asyncInvoke) {
        return {
            statusCode: response.StatusCode ?? 202,
            requestId: response.$metadata?.requestId || null,
        };
    }
    if (!response.Payload) {
        return {};
    }
    const responseStr = Buffer.from(response.Payload).toString().trim();
    if (!responseStr) {
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(responseStr);
    }
    catch (err) {
        console.error("Failed to parse Lambda response:", responseStr);
        throw err;
    }
    const errorMessage = extractLambdaError(response, parsed);
    if (errorMessage) {
        throw new Error(`Lambda invoke failed for ${functionName}: ${String(errorMessage)}`);
    }
    return parsed;
};
exports.invokeLambda = invokeLambda;
