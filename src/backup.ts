import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { MongoClient } from 'mongodb';
import { Guest } from "./models/guestmodel";
import { Event } from "./models/eventmodel";
import { Admin } from "./models/adminmodel";

const s3 = new S3Client({ region: process.env.AWS_REGION });

export const handler = async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
    
    const timestamp = new Date().toISOString();
    const backupPromises = [
      backupCollection(client, Event.collection.collectionName, timestamp),
      backupCollection(client, Guest.collection.collectionName, timestamp),
      backupCollection(client, Admin.collection.collectionName, timestamp)
    ];

    await Promise.all(backupPromises);
    await client.close();

    return { 
      statusCode: 200,
      body: JSON.stringify({ message: 'Backup completed successfully' })
    };
  } catch (error) {
    console.error('Backup error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Backup failed', details: errorMessage }),
    };
  }
};

async function backupCollection(client: MongoClient, collectionName: string, timestamp: string) {
  const db = client.db();
  const data = await db.collection(collectionName).find().toArray();
  
  await s3.send(new PutObjectCommand({
    Bucket: process.env.BACKUP_BUCKET,
    Key: `backups/${timestamp}/${collectionName}.json`,
    Body: JSON.stringify(data),
    ContentType: 'application/json'
  }));
}