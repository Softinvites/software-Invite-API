// utils/s3.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
    // ACL: acl, — bucket uses BucketOwnerEnforced; public access via bucket policy
    Metadata: metadata
  }));

  return buildS3PublicUrl(fullKey);
};

export const deleteFromS3 = async (key: string): Promise<void> => {
  await s3.send(new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key
  }));
};

export const buildS3PublicUrl = (key: string): string => {
  const normalizedKey = String(key || '').replace(/^\/+/, '');
  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${normalizedKey}`;
};

export const createPresignedUploadUrl = async (
  key: string,
  contentType: string,
  expiresIn: number = 900
): Promise<{ uploadUrl: string; fileUrl: string; key: string }> => {
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn }
  );

  return {
    uploadUrl,
    fileUrl: buildS3PublicUrl(key),
    key,
  };
};
