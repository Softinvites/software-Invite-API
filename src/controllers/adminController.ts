import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Admin } from "../models/adminModel";
import {
  RegisterAdminSchema,
  LoginAdminSchema,
  updateAdminProfileSchema,
  UpdatePasswordSchema,
  option,
} from "../utils/utils";

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
    }

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      res.status(400).json({ message: "Admin already exists" });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      await bcrypt.genSalt(12)
    );
    const newAdmin = await Admin.create({
      username,
      email,
      password: hashedPassword,
      name,
    });
    res
      .status(201)
      .json({ message: "Admin registered successfully", data: newAdmin });
  } catch (error) {
    res.status(500).json({ message: "Error registering admin" });
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
    }

    const admin = (await Admin.findOne({ email })) as unknown as {
      [key: string]: string;
    };

    if (!admin) {
      res
        .status(400)
        .json({ message: "Invalid email or password, or user not found" });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      res.status(400).json({ message: "Invalid email or password" });
    }

    const { _id } = admin;

    //generate token
    const token = jwt.sign({ _id }, jwtsecret, { expiresIn: "1h" });

    res.status(200).json({ message: "Login successful", admin, token });
  } catch (error) {
    res.status(500).json({ message: "Error logging in admin" });
    console.error("Something went wrong login in");
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
    const admins = await Admin.find({}).populate("admin");

    res.status(200).json({ msg: "All Admins successfully fetched", admins });
  } catch (error) {
    res.status(500).json({ message: "Error fetching admins" });
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

    const admin = await Admin.findById({ _id: id });

    if (!admin) {
      res.status(400).json({
        error: "Admin not found",
      });
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
    const validateAmin = UpdatePasswordSchema.validate(req.body, option);

    if (validateAmin.error) {
      res.status(400).json({ Error: validateAmin.error.details[0].message });
    }

    const admin = await Admin.findById({ _id: id });

    if (!admin) {
      res.status(400).json({
        error: "Admin not found",
      });
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(
      id,
      { old_password, new_password, confirm_password },
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    );

    res.status(200).json({
      message: "Admin Password updated successfully",
      admin: updatedAdmin,
    });
  } catch (error) {
    res.status(500).json({ message: "Error updating Passwords" });
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
