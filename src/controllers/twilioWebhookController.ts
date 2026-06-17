import { Request, Response } from "express";
import twilio from "twilio";
import whatsappService from "../utils/whatsappService.js";
import { persistInboundWhatsAppMessage } from "../services/whatsappInboundService.js";

const buildTwilioWebhookUrl = (req: Request) => {
  const explicitBase = process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, "");
  if (explicitBase) {
    return `${explicitBase}${req.originalUrl}`;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(
    req.headers["x-forwarded-host"] || req.headers.host || "",
  )
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host") || "";

  return `${protocol}://${host}${req.originalUrl}`;
};

const validateTwilioWebhook = (req: Request) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.header("x-twilio-signature");

  if (!authToken) {
    console.warn("TWILIO_AUTH_TOKEN not configured — skipping signature validation");
    return true;
  }

  if (!signature) {
    console.warn("No x-twilio-signature header — skipping validation");
    return true;
  }

  const url = buildTwilioWebhookUrl(req);
  const isValid = twilio.validateRequest(
    authToken,
    signature,
    url,
    req.body || {},
  );

  if (!isValid) {
    console.warn("[TwilioWebhook] Signature mismatch — URL used for validation:", url);
  }

  return isValid;
};

export const handleTwilioWhatsAppInbound = async (
  req: Request,
  res: Response,
) => {
  try {
    const isValid = validateTwilioWebhook(req);
    if (!isValid) {
      console.warn("[TwilioWebhook] Inbound signature invalid — processing anyway to avoid missed messages");
    }

    console.log("📩 Twilio WhatsApp inbound message received", {
      from: req.body?.From || null,
      profileName: req.body?.ProfileName || null,
      body: req.body?.Body || null,
      waId: req.body?.WaId || null,
      messageSid: req.body?.MessageSid || req.body?.SmsSid || null,
      bodyKeys: Object.keys(req.body || {}),
    });

    const saved = await persistInboundWhatsAppMessage({
      provider: "twilio",
      from: req.body?.From || "",
      to: req.body?.To || null,
      body: req.body?.Body || "",
      profileName: req.body?.ProfileName || null,
      waId: req.body?.WaId || null,
      providerMessageId: req.body?.MessageSid || req.body?.SmsSid || null,
      payload: req.body || {},
      receivedAt: new Date(),
    });
    console.log("[TwilioInbound] Persisted inbound message", {
      id: (saved as any)?._id,
      from: req.body?.From,
      waId: req.body?.WaId,
      eventId: (saved as any)?.eventId,
      guestId: (saved as any)?.guestId,
      rsvpId: (saved as any)?.rsvpId,
    });

    res.type("text/xml").status(200).send("<Response></Response>");
  } catch (error: any) {
    console.error("Twilio WhatsApp inbound webhook error:", error);
    res.status(500).json({
      message: "Failed to process Twilio WhatsApp inbound webhook",
      error: error.message || String(error),
    });
  }
};

export const handleTwilioWhatsAppStatusCallback = async (
  req: Request,
  res: Response,
) => {
  try {
    const isValid = validateTwilioWebhook(req);
    if (!isValid) {
      console.warn("[TwilioWebhook] Status callback signature invalid — processing anyway");
    }

    const providerMessageId =
      req.body?.MessageSid || req.body?.SmsSid || req.body?.SmsMessageSid;
    const status = String(req.body?.MessageStatus || "").toLowerCase();

    if (!providerMessageId || !status) {
      return res.status(200).json({ message: "Ignored empty Twilio status callback" });
    }

    await whatsappService.updateMessageStatus(
      providerMessageId,
      status,
      undefined,
      req.body?.ErrorMessage || req.body?.ChannelStatusMessage || undefined,
    );

    console.log("📊 Twilio WhatsApp status callback processed", {
      providerMessageId,
      status,
      errorCode: req.body?.ErrorCode || null,
      errorMessage: req.body?.ErrorMessage || null,
      channelStatusMessage: req.body?.ChannelStatusMessage || null,
    });

    res.status(200).send("OK");
  } catch (error: any) {
    console.error("Twilio WhatsApp status callback error:", error);
    res.status(500).json({
      message: "Failed to process Twilio WhatsApp status callback",
      error: error.message || String(error),
    });
  }
};
