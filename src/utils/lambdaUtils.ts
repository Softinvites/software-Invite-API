import { lambda } from './awsConfig';

export const invokeLambda = async (functionName: string, payload: any) => {
  const params = {
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload),
  };


  console.log('Invoking Lambda with payload:', payload);
const response = await lambda.invoke(params).promise();
console.log('Lambda response:', response);
  // const response = await lambda.invoke(params).promise();
  return JSON.parse(response.Payload as string);
};