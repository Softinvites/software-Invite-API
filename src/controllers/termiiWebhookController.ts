import { Request, Response } from "express";
import { SmsMessage } from "../models/smsMessage";

/**
 * Termii SMS Status Callback Handler
 * 
 * Receives delivery status updates from Termii for SMS messages
 * Webhook payload format:
 * {
 *   message_id: "string",           // The message ID stored as providerMessageId
 *   status: "sent" | "delivered" | "failed",
 *   phone_number: "+234...",        // Recipient phone number
 *   timestamp: "ISO-8601 or unix",  // When the status change occurred
 *   error_message?: "string",       // Error details if status is failed
 *   cost?: number,                  // Cost of the SMS if applicable
 * }
 */
export const handleTermiiSmsStatusCallback = async (
  req: Request,
  res: Response,
) => {
  try {
    const webhookSecret = process.env.TERMII_WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = req.query.secret || req.headers["x-termii-secret"];
      if (provided !== webhookSecret) {
        console.warn("[Termii Webhook] Invalid secret — request rejected");
        return res.status(200).json({ success: false, message: "Invalid secret" });
      }
    }

    const {
      message_id,
      messageId,
      status,
      phone_number,
      timestamp,
      error_message,
      cost,
    } = req.body;

    // Normalize message ID (Termii may use either message_id or messageId)
    const providerMessageId = message_id || messageId;
    
    if (!providerMessageId) {
      console.warn("[Termii Webhook] Missing message_id in payload:", req.body);
      return res.status(400).json({ error: "Missing message_id" });
    }

    // Normalize status
    const normalizedStatus = normalizeTermiiStatus(
      status?.toLowerCase() || "unknown"
    );

    if (normalizedStatus === "unknown") {
      console.warn(
        `[Termii Webhook] Unknown status received: ${status} for message ${providerMessageId} — acknowledging anyway`
      );
      return res.status(200).json({ success: true, message: "Status acknowledged" });
    }

    // Build update object
    const updateData: any = {
      status: normalizedStatus,
    };

    // Parse timestamp
    const parsedTimestamp = parseTermiiTimestamp(timestamp);
    if (parsedTimestamp) {
      if (normalizedStatus === "delivered") {
        updateData.deliveredAt = parsedTimestamp;
      } else if (normalizedStatus === "sent") {
        updateData.sentAt = parsedTimestamp;
      } else if (normalizedStatus === "failed") {
        updateData.failedAt = parsedTimestamp;
      }
    }

    // Store error message if status is failed
    if (normalizedStatus === "failed" && error_message) {
      updateData.errorMessage = error_message;
    }

    // Store cost if provided
    if (cost !== undefined && cost !== null) {
      updateData.cost = cost;
    }

    // Update SMS message in database
    const result = await SmsMessage.findOneAndUpdate(
      { providerMessageId },
      updateData,
      { new: true }
    );

    if (!result) {
      console.warn(
        `[Termii Webhook] SMS message not found with providerMessageId: ${providerMessageId}`
      );
      // Still return 200 to prevent Termii from retrying
      return res.status(200).json({
        success: true,
        message: "Status received but message record not found",
      });
    }

    console.log(
      `[Termii Webhook] Updated SMS ${providerMessageId} to status: ${normalizedStatus}`
    );

    res.status(200).json({
      success: true,
      message: "Status updated successfully",
      messageId: providerMessageId,
      status: normalizedStatus,
    });
  } catch (error: any) {
    console.error("[Termii Webhook] Error processing callback:", error);
    // Return 200 anyway to prevent Termii retries
    res.status(200).json({
      success: false,
      message: "Error processing webhook",
      error: error?.message,
    });
  }
};

/**
 * Normalize Termii status to our standard SMS statuses
 * Termii statuses can be: "sent", "delivered", "failed", "pending", etc.
 */
function normalizeTermiiStatus(
  status: string
): "sent" | "delivered" | "failed" | "queued" | "unknown" {
  const statusMap: Record<string, "sent" | "delivered" | "failed" | "queued"> = {
    sent: "sent",
    delivered: "delivered",
    failed: "failed",
    failed_invalid_phone: "failed",
    failed_no_network: "failed",
    failed_phone_offline: "failed",
    bounced: "failed",
    pending: "queued",
    queued: "queued",
  };

  return (statusMap[status] || "unknown") as any;
}

/**
 * Parse Termii timestamp (can be ISO-8601 string or unix timestamp)
 */
function parseTermiiTimestamp(timestamp: any): Date | null {
  if (!timestamp) return null;

  try {
    // If it's a number, treat as unix timestamp (seconds or milliseconds)
    if (typeof timestamp === "number") {
      // If greater than 10^11, assume milliseconds; otherwise seconds
      const ts = timestamp > 100000000000 ? timestamp : timestamp * 1000;
      return new Date(ts);
    }

    // If it's a string, try parsing as ISO-8601
    if (typeof timestamp === "string") {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  } catch (error) {
    console.warn(`[Termii Webhook] Failed to parse timestamp: ${timestamp}`, error);
    return null;
  }
}
