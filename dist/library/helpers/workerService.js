"use strict";
// import { DownloadTask } from './models/DownloadTask';
// import { Guest } from './models/Guest';
// import { processBatch } from './utils/processBatch';
// import archiver from 'archiver';
// import cloudinary from './utils/cloudinary';
// const pollDownloadTasks = async () => {
//   const task = await DownloadTask.findOneAndUpdate(
//     { status: 'pending' },
//     { status: 'processing' },
//     { new: true }
//   );
//   if (!task) return;
//   try {
//     const guests = await Guest.find({ eventId: task.eventId });
//     const archive = archiver('zip', { zlib: { level: 9 } });
//     const uploadPromise = new Promise<string>((resolve, reject) => {
//       const uploadStream = cloudinary.uploader.upload_stream(
//         { resource_type: 'raw', folder: 'qrcodes', format: 'zip' },
//         (error, result) => {
//           if (error) reject(error);
//           else resolve(result?.secure_url ?? '');
//         }
//       );
//       archive.pipe(uploadStream);
//     });
//     const batchSize = 20;
//     for (let i = 0; i < guests.length; i += batchSize) {
//       const batch = guests.slice(i, i + batchSize);
//       const files = await processBatch(batch);
//       files.forEach(file => archive.append(file.buffer, { name: file.name }));
//     }
//     archive.finalize();
//     const downloadLink = await uploadPromise;
//     await DownloadTask.findByIdAndUpdate(task._id, {
//       status: 'completed',
//       downloadLink,
//     });
//   } catch (err: any) {
//     console.error('Error processing QR code task:', err);
//     await DownloadTask.findByIdAndUpdate(task._id, {
//       status: 'failed',
//       error: err.message,
//     });
//   }
// };
// // Poll every 5 seconds
// setInterval(pollDownloadTasks, 5000);
