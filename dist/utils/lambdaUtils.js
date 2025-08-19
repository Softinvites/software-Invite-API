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
const awsConfig_1 = require("./awsConfig");
const invokeLambda = (functionName, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const params = {
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(payload),
    };
    console.log('Invoking Lambda with payload:', payload);
    const response = yield awsConfig_1.lambda.invoke(params).promise();
    console.log('Lambda response:', response);
    // const response = await lambda.invoke(params).promise();
    return JSON.parse(response.Payload);
});
exports.invokeLambda = invokeLambda;
