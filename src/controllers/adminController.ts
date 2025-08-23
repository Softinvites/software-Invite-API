import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { Admin } from "../models/adminmodel";
import mongoose from "mongoose";
import {
  RegisterAdminSchema,
  LoginAdminSchema,
  updateAdminProfileSchema,
  UpdatePasswordSchema,
  option,
} from "../utils/utils";
import { connectDB } from "../db";


dotenv.config();
const jwtsecret = process.env.JWT_SECRET as string;

export const registerAdmin = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { username, email, password, confirm_password, name } = req.body;

    const validateAdnin = RegisterAdminSchema.validate(req.body, option);

    if (validateAdnin.error) {
      res.status(400).json({ Error: validateAdnin.error.details[0].message });
      return;
    }

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      res.status(400).json({ message: "Admin already exists" });
      return;
    }

    const hashedPassword = await bcrypt.hash(
      password,
      await bcrypt.genSalt(12)
    );
    const newAdmin = new Admin({
      username,
      email,
      password: hashedPassword,
      name,
    });
    await newAdmin.save();
    res
      .status(201)
      .json({ message: "Admin registered successfully", data: newAdmin });
    return;
  } catch (error) {
    res.status(500).json({ message: "Error registering admin" });
    return;
    console.log(error);
  }
};

export const loginAdmin = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, password } = req.body;

    const validateAmin = LoginAdminSchema.validate(req.body, option);

    if (validateAmin.error) {
      res.status(400).json({ Error: validateAmin.error.details[0].message });
      return;
    }

    const admin = await Admin.findOne({ email });

    if (!admin) {
      res
        .status(400)
        .json({ message: "Invalid email or password, or user not found" });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      res.status(400).json({ message: "Invalid email or password" });
      return;
    }

    const { _id } = admin;

    //generate token
    const token = jwt.sign({ _id }, jwtsecret, { expiresIn: "1h" });

    res.status(200).json({ message: "Login successful", admin, token });
    return;
  } catch (error) {
    console.error("Something went wrong logging in:", error);
    res.status(500).json({ message: "Error logging in admin" });
    return;
  }
};

export const getAdminProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const admin = await Admin.findById(id);

    if (!admin) {
      res.status(404).json({ message: "Admin not found" });
    }

    res.status(200).json({ message: "Admin successfully fetched", admin });
  } catch (error) {
    res.status(500).json({ message: "Error fetching admin profile" });
  }
};

export const getAllAdminProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const admins = await Admin.find({});

    res.status(200).json({ msg: "All Admins successfully fetched", admins });
  } catch (error) {
    
    res.status(500).json({ message: "Error fetching admins", error: error });
  }
};

export const updateAdminProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, username } = req.body;

    const validateAmin = updateAdminProfileSchema.validate(req.body, option);

    if (validateAmin.error) {
      res.status(400).json({ Error: validateAmin.error.details[0].message });
    }

    const admin = await Admin.findById(id);
    console.log("Admin fetched:", admin); 


    if (!admin) {
      res.status(400).json({
        error: "Admin not found",
      });
      return;
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(
      id,
      { name, username },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    );

    res
      .status(200)
      .json({ message: "Profile updated successfully", admin: updatedAdmin });
  } catch (error) {
    console.error("Error updating Admin Profile", error)
    res.status(500).json({ message: "Error updating profile" });
  }
};

export const updateAdminPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { old_password, new_password, confirm_password } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    // Validate request body
    const validateAmin = UpdatePasswordSchema.validate(req.body, option);
    if (validateAmin.error) {
      res.status(400).json({ Error: validateAmin.error.details[0].message });
      return;  // Stop execution
    }


    // Fetch admin
    const admin = await Admin.findById(id);
    if (!admin) {
      res.status(404).json({ error: "Admin not found" });
      return;
    }

    // Compare old password
    const isMatch = await bcrypt.compare(old_password, admin.password);
    if (!isMatch) {
      res.status(400).json({ error: "Old password is incorrect" });
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // Update password
    admin.password = hashedPassword;
    await admin.save();

    res.status(200).json({ message: "Admin password updated successfully" });
  } catch (error) {
    console.error("Password update error:", error);
    res.status(500).json({ message: "Error updating password" });
  }
};


export const deleteAdmin = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    await Admin.findByIdAndDelete(id);
    res.status(200).json({ message: "Admin deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting admin" });
  }
};
