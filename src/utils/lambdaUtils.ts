import { lambda } from './awsConfig';

export const invokeLambda = async (functionName: string, payload: any) => {
  const params = {
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload),
  };

  const response = await lambda.invoke(params).promise();
  return JSON.parse(response.Payload as string);
};