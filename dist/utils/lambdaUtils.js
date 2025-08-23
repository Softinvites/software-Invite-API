"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeLambda = void 0;
const client_lambda_1 = require("@aws-sdk/client-lambda");
const awsConfig_1 = require("./awsConfig");
const invokeLambda = (functionName_1, payload_1, ...args_1) => __awaiter(void 0, [functionName_1, payload_1, ...args_1], void 0, function* (functionName, payload, asyncInvoke = false) {
    const params = {
        FunctionName: functionName,
        InvocationType: asyncInvoke ? "Event" : "RequestResponse",
        Payload: Buffer.from(JSON.stringify(payload)),
    };
    const command = new client_lambda_1.InvokeCommand(params);
    const response = yield awsConfig_1.lambda.send(command);
    // If async, Lambda does not return a payload
    if (asyncInvoke) {
        return { statusCode: 202, body: "{}" };
    }
    // Otherwise parse normally
    const responsePayload = response.Payload ? Buffer.from(response.Payload).toString() : "{}";
    return JSON.parse(responsePayload);
});
exports.invokeLambda = invokeLambda;
