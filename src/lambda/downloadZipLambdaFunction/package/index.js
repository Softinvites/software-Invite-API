import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import archiver from 'archiver';
import { PassThrough } from 'stream';
const s3 = new S3Client({ region: process.env.AWS_REGION });
export const handler = async (event) => {
    try {
        const { qrPaths, eventId } = event;
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level
        });
        const pass = new PassThrough();
        const chunks = [];
        pass.on('data', (chunk) => chunks.push(chunk));
        // Add each QR code to the archive
        for (const path of qrPaths) {
            try {
                const { Body } = await s3.send(new GetObjectCommand({
                    Bucket: process.env.S3_BUCKET,
                    Key: path
                }));
                if (Body) {
                    // Convert the Body to a Readable stream
                    const bodyStream = Body;
                    archive.append(bodyStream, {
                        name: path.split('/').pop() || `qr_${Date.now()}.png`,
                        // Preserve the original file date if available
                        date: new Date()
                    });
                }
            }
            catch (error) {
                console.error(`Error processing ${path}:`, error);
                // Continue with other files even if one fails
            }
        }
        archive.pipe(pass);
        await archive.finalize();
        // Wait for the stream to finish
        await new Promise((resolve) => pass.on('end', resolve));
        const zipBuffer = Buffer.concat(chunks);
        const zipKey = `qr_zips/event_${eventId}_${Date.now()}.zip`;
        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: zipKey,
            Body: zipBuffer,
            ContentType: 'application/zip',
            ACL: 'public-read',
            Metadata: {
                'event-id': eventId,
                'generated-at': new Date().toISOString()
            }
        }));
        const zipUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${zipKey}`;
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                zipUrl,
                eventId,
                generatedAt: new Date().toISOString(),
                numberOfFiles: qrPaths.length
            })
        };
    }
    catch (error) {
        console.error('Error creating zip:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Error creating zip file',
                error: error instanceof Error ? error.message : 'Unknown error',
                eventId: event?.eventId || 'unknown'
            })
        };
    }
};
