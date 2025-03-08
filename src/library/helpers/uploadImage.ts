import { v2 as cloudinary } from "cloudinary";
import { Request } from "express";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer, { FileFilterCallback } from "multer";
// import UserRequest from "../../types/userRequest";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

const csvExcelStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    resource_type: "auto",
    public_id: (req: Request, file: Express.Multer.File) =>
      `uploads/${file.originalname}`, // Ensure file is saved in "uploads" folder
  } as unknown as { folder: string }, // Explicitly cast to include `folder`
});

// ✅ Corrected File Filter with Proper Type Annotations
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (
    file.mimetype === "text/csv" ||
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only CSV and Excel files are allowed."));
  }
};

// ✅ Multer Middleware for CSV & Excel Uploads
export const uploadCSVExcel = multer({
  storage: csvExcelStorage,
  fileFilter,
});
