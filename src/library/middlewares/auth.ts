import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Admin } from "../../models/adminmodel";

const jwtSecret = process.env.JWT_SECRET as string;

// Extend Request type to include admin property
interface AuthenticatedRequest extends Request {
  admin?: { _id: string };
}

const auth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      res.status(401).json({ message: "Kindly sign in as a user" });
      return; // Ensure function exits
    }

    const token = authorization.split(" ")[1];

    let verify;
    try {
      verify = jwt.verify(token, jwtSecret) as { _id: string };
    } catch (err) {
      res.status(401).json({ message: "Invalid or expired token" });
      return; // Ensure function exits
    }

    const admin = await Admin.findById(verify._id);
    if (!admin) {
      res.status(404).json({ message: "User not found" });
      return; // Ensure function exits
    }

    req.admin = verify;
    next(); // Call next to continue request flow
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export default auth;
