import { Request, Response } from "express";
import twilio from "twilio";
import whatsappService from "../utils/whatsappService.js";
import { persistInboundWhatsAppMessage } from "../services/whatsappInboundService.js";
import { respondFromWhatsAppButton } from "./rsvpController.js";
import { sendSmsFallbackForWhatsApp } from "../services/smsFallbackService";

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
      buttonPayload: req.body?.ButtonPayload || null,
      repliedSid: req.body?.OriginalRepliedMessageSid || null,
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

    const twiml = new twilio.twiml.MessagingResponse();
    const buttonReply = await respondFromWhatsAppButton(req.body || {});
    if (buttonReply) twiml.message(buttonReply);

    res.type("text/xml").status(200).send(twiml.toString());
  } catch (error: any) {
    console.error("Twilio WhatsApp inbound webhook error:", error);
    res.status(500).json({
      message: "Failed to process Twilio WhatsApp inbound webhook",
      error: error.message || String(error),
    });
  }
};

const WHATSAPP_ERROR_REASONS: Record<string, string> = {
  "63049":
    "Meta did not deliver this marketing message (per-person marketing limit or Meta's engagement rules). Usually affects numbers that received many messages recently.",
  "63016": "Outside WhatsApp's 24-hour window; only approved templates can be sent.",
  "63024": "Invalid recipient for WhatsApp.",
  "63003": "This number is not reachable on WhatsApp.",
  "63032": "The recipient has stopped marketing messages from this business.",
  "63018": "Rate limit reached for this WhatsApp sender.",
  "63019": "Media in the message could not be downloaded or is invalid.",
  "63051": "The recipient's WhatsApp account is temporarily locked.",
  "63112": "The WhatsApp Business account is disabled or restricted by Meta.",
  "63013": "Meta rejected the message under its policy.",
  "63027": "The template could not be delivered (template or variables mismatch).",
  "30008": "Unknown delivery error from the carrier.",
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

    // Twilio usually sends only ErrorCode, so store a readable reason for the
    // WhatsApp Status dialog instead of leaving failures unexplained.
    const errorCode = String(req.body?.ErrorCode || "").trim();
    const reason =
      req.body?.ErrorMessage ||
      req.body?.ChannelStatusMessage ||
      (errorCode
        ? `${WHATSAPP_ERROR_REASONS[errorCode] || "WhatsApp could not deliver this message."} (error ${errorCode})`
        : undefined);

    await whatsappService.updateMessageStatus(
      providerMessageId,
      status,
      undefined,
      reason,
    );

    // SMS backup for events that switched it on (never blocks the callback).
    if (status === "undelivered" || status === "failed") {
      try {
        await sendSmsFallbackForWhatsApp(providerMessageId, errorCode);
      } catch (fallbackError) {
        console.error("[SmsFallback] unexpected error", fallbackError);
      }
    }

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
