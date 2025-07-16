// utils/s3.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION });

type S3ACL = 
  | 'private'
  | 'public-read'
  | 'public-read-write'
  | 'authenticated-read'
  | 'aws-exec-read'
  | 'bucket-owner-read'
  | 'bucket-owner-full-control';

interface UploadToS3Options {
  folder?: string;
  acl?: S3ACL; 
  metadata?: Record<string, string>;
}

export const uploadToS3 = async (
  buffer: Buffer,
  key: string,
  contentType: string,
  options: UploadToS3Options = {}
): Promise<string> => {
  const { folder = '', acl = 'public-read', metadata = {} } = options;
  
  const fullKey = folder ? `${folder}/${key}` : key;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: fullKey,
    Body: buffer,
    ContentType: contentType,
    // ACL: acl,
    Metadata: metadata
  }));

  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fullKey}`;
};

export const deleteFromS3 = async (key: string): Promise<void> => {
  await s3.send(new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key
  }));
};