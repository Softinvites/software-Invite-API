import { Request, Response } from "express";
import crypto from "crypto";
import whatsappService from "../utils/whatsappService.js";

const WHATSAPP_WEBHOOK_VERIFY_TOKEN =
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "softinvites_webhook_2025";
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;

// GET endpoint for webhook verification
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔍 Webhook verification request:", { mode, token, challenge });

  // Verify the webhook
  if (mode === "subscribe" && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verified");
    res.status(200).send(challenge);
  } else {
    console.log("❌ WhatsApp webhook verification failed");
    res.sendStatus(403);
  }
};

// POST endpoint for receiving webhook events
export const handleWebhook = async (req: Request, res: Response) => {
  const signature = req.headers["x-hub-signature-256"] as string;

  console.log(
    "📨 WhatsApp webhook received:",
    JSON.stringify(req.body, null, 2),
  );

  // Verify payload signature if app secret is provided
  if (WHATSAPP_APP_SECRET && signature) {
    const payloadBuffer: Buffer | undefined = (req as any).rawBody;
    const dataToSign = payloadBuffer
      ? payloadBuffer
      : Buffer.from(JSON.stringify(req.body));

    const expectedSignature =
      "sha256=" +
      crypto
        .createHmac("sha256", WHATSAPP_APP_SECRET)
        .update(dataToSign)
        .digest("hex");

    if (signature !== expectedSignature) {
      console.log("❌ Invalid webhook signature");
      return res.sendStatus(403);
    }
  }

  // Process webhook data
  const { entry } = req.body;
  if (entry && Array.isArray(entry) && entry.length > 0) {
    for (const item of entry) {
      if (!item || !item.changes) continue;
      for (const change of item.changes) {
        if (change.field !== "messages") continue;
        console.log("📱 Message update:", change.value);

        // Handle message status updates and persist them
        const statuses = change.value?.statuses;
        if (Array.isArray(statuses)) {
          for (const status of statuses) {
            console.log(`📊 Message ${status.id} status: ${status.status}`);
            try {
              await whatsappService.updateMessageStatus(
                status.id,
                status.status,
                status.timestamp,
              );
            } catch (err) {
              console.error("Failed to update message status:", err);
            }
          }
        }

        // Handle incoming messages
        const messages = change.value?.messages;
        if (Array.isArray(messages)) {
          for (const message of messages) {
            console.log(
              `📩 Incoming message from ${message.from}: ${message.text?.body || "Media message"}`,
            );
            // Handle incoming messages here if needed
          }
        }
      }
    }
  }

  res.sendStatus(200);
};
