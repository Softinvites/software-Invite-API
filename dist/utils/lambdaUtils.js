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
const invokeLambda = (functionName, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const params = {
        FunctionName: functionName,
        InvocationType: "RequestResponse", // 👈 fix
        Payload: Buffer.from(JSON.stringify(payload)),
    };
    const command = new client_lambda_1.InvokeCommand(params);
    const response = yield awsConfig_1.lambda.send(command);
    // response.Payload is Uint8Array | undefined, so convert to string
    const responsePayload = response.Payload
        ? Buffer.from(response.Payload).toString()
        : "{}";
    return JSON.parse(responsePayload);
});
exports.invokeLambda = invokeLambda;
