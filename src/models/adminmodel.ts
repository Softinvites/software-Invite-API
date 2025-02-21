import { Schema, model, Document } from "mongoose";

interface AdminDocument extends Document {
  username: string;
  email: string;
  password: string; 
  name: string;
}

const AdminSchema = new Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
});

export const Admin = model<AdminDocument>("Admin", AdminSchema);