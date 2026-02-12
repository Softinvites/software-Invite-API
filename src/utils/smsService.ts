import axios from "axios";
import { SmsMessage } from "../models/smsMessage";
import twilio from "twilio";

type SendSmsInput = {
  to: string;
  message: string;
  eventId: string;
  rsvpId?: string;
};

const resolveSmsProvider = () => {
  if (process.env.SMS_PROVIDER) return process.env.SMS_PROVIDER;
  if (process.env.TERMII_API_KEY) return "termii";
  if (process.env.TWILIO_ACCOUNT_SID) return "twilio";
  return "none";
};

const canSendSms = async (rsvpId?: string) => {
  if (!rsvpId) return true;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await SmsMessage.countDocuments({
    rsvpId,
    createdAt: { $gte: since },
  });
  return count < 3;
};

const sendViaTwilio = async (to: string, message: string) => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials not configured");
  }
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
  const from = process.env.TWILIO_SMS_FROM;
  if (!from) throw new Error("TWILIO_SMS_FROM not configured");

  return client.messages.create({ to, from, body: message });
};

const sendViaTermii = async (to: string, message: string) => {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) throw new Error("TERMII_API_KEY not configured");
  const baseUrl = process.env.TERMII_BASE_URL || "https://api.ng.termii.com";
  const url =
    process.env.TERMII_SMS_URL ||
    `${baseUrl.replace(/\/$/, "")}/api/sms/send`;

  const payload = {
    to,
    from: process.env.TERMII_SENDER_ID || "SoftInvites",
    sms: message,
    type: "plain",
    api_key: apiKey,
    channel: process.env.TERMII_CHANNEL || "generic",
  };

  const response = await axios.post(url, payload);
  return response.data;
};

const smsService = {
  sendSms: async (input: SendSmsInput) => {
    const { to, message, eventId, rsvpId } = input;
    if (!to) {
      return { success: false, error: "Missing recipient phone" };
    }
    const allowed = await canSendSms(rsvpId);
    if (!allowed) {
      return { success: false, error: "Daily SMS limit reached" };
    }

    const provider = resolveSmsProvider();
    if (provider === "none") {
      return { success: false, error: "SMS provider not configured" };
    }

    try {
      let providerMessageId = "";
      if (provider === "twilio") {
        const result = await sendViaTwilio(to, message);
        providerMessageId = result.sid;
      } else {
        const result = await sendViaTermii(to, message);
        providerMessageId =
          result?.message_id || result?.messageId || result?.data?.message_id || "";
      }

      await SmsMessage.create({
        eventId,
        rsvpId: rsvpId || null,
        to,
        status: "sent",
        providerMessageId,
        provider,
        sentAt: new Date(),
      });

      return { success: true, providerMessageId };
    } catch (error: any) {
      await SmsMessage.create({
        eventId,
        rsvpId: rsvpId || null,
        to,
        status: "failed",
        provider,
        errorMessage: error?.message || "SMS send failed",
      });

      return { success: false, error: error?.message || "SMS send failed" };
    }
  },
};

export default smsService;
