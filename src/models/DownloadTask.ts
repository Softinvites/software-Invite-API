import mongoose from 'mongoose';

const DownloadTaskSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  downloadLink: { type: String },
  error: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const DownloadTask = mongoose.model('DownloadTask', DownloadTaskSchema);
