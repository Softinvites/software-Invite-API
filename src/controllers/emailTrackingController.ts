import { Request, Response } from "express";
import { EmailMessage } from "../models/emailMessage";

const transparentGif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

export const trackEmailOpen = async (req: Request, res: Response) => {
  try {
    const { trackingId } = req.params;
    if (trackingId) {
      await EmailMessage.updateOne(
        { trackingId },
        {
          $inc: { openCount: 1 },
          $set: { lastOpenAt: new Date() },
        },
      );
    }
  } catch (error) {
    console.warn("trackEmailOpen error:", error);
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.status(200).send(transparentGif);
};

export const trackEmailClick = async (req: Request, res: Response) => {
  const { trackingId } = req.params;
  const url = typeof req.query.url === "string" ? req.query.url : "";
  try {
    if (trackingId) {
      await EmailMessage.updateOne(
        { trackingId },
        {
          $inc: { clickCount: 1 },
          $set: { lastClickAt: new Date() },
        },
      );
    }
  } catch (error) {
    console.warn("trackEmailClick error:", error);
  }

  if (!url) {
    return res.status(400).send("Missing url");
  }
  return res.redirect(url);
};
