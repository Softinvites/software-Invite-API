import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

let cachedConnection: typeof mongoose | null = null;

export async function connectDB() {
  if (cachedConnection) {
    return cachedConnection;
  }

  const connection = await mongoose.connect(process.env.MONGODB_URI!, {
    family: 4,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  });

  cachedConnection = connection;
  return connection;
}
