import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { Admin } from "../../models/adminmodel";

// Extend Request to include admin and eventId
interface AuthenticatedRequest extends Request {
  admin?: { _id: string };
  eventId?: string;
}

const jwtSecret = process.env.JWT_SECRET as string;

export const combinedAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token =
    req.query.token ||
    req.headers["x-access-token"] ||
    req.headers.authorization?.split(" ")[1];

  if (!token) {
    res.status(403).json({ message: "No token provided" });
    return;
  }

  try {
    const decoded = jwt.verify(token as string, jwtSecret) as JwtPayload | string;

    // ✅ Check if decoded is a JwtPayload (not a string)
    if (typeof decoded === "object" && decoded !== null) {
      // ✅ Check if it's an admin token
      if (decoded._id) {
        const admin = await Admin.findById(decoded._id);
        if (admin) {
          req.admin = { _id: decoded._id as string };
          return next();
        }
      }

      // ✅ Check if it's a temp token for check-in
      if (decoded.type === "checkin") {
        req.eventId = decoded.eventId as string;
        return next();
      }
    }

    res.status(403).json({ message: "Unauthorized access" });
  } catch (error) {
    console.error("Auth error:", error);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};
