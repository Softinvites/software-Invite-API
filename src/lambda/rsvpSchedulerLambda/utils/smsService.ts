import axios from "axios";
type SendSmsInput = {
  to: string;
  message: string;
  eventId: string;
  rsvpId?: string;
};

/**
 * Termii (and every SMS gateway) requires international format. The old version
 * only stripped separators, so a guest stored as "08169881336" was posted
 * verbatim and rejected — "Recipient phone number is not a valid, dialable
 * number". Since most Nigerian guest lists are imported in local 0… format,
 * that silently broke SMS for the bulk of recipients.
 */
const DEFAULT_COUNTRY_CODE = process.env.SMS_DEFAULT_COUNTRY_CODE || "234";

const normalizePhone = (phone: string): string => {
  let digits = String(phone || "").replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) digits = digits.slice(1);
  // 00234… international access prefix
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Local trunk prefix: 0803… → 234803…
  if (digits.startsWith("0")) return DEFAULT_COUNTRY_CODE + digits.slice(1);
  // Bare 10-digit national number with the trunk 0 already stripped
  if (digits.length === 10 && /^[789]/.test(digits)) {
    return DEFAULT_COUNTRY_CODE + digits;
  }
  return digits;
};

const canSendSms = async (rsvpId?: string): Promise<boolean> => {
  if (!rsvpId) return true;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // SmsMessage is not available in the scheduler lambda — skip rate-limit check
  // to avoid a missing-model error. The main app lambda enforces this.
  return true;
};

/**
 * Opt-in retry on Termii's generic route when the configured route (usually
 * `dnd`) is not provisioned. Off by default — see the note in sendViaTermii.
 */
const isGenericFallbackEnabled = () =>
  String(process.env.TERMII_ALLOW_GENERIC_FALLBACK || "")
    .trim()
    .toLowerCase() === "true";

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

  try {
    const response = await axios.post(url, payload);
    return response.data;
  } catch (error: any) {
    // A workspace without the route provisioned returns 422 "Route not
    // configured for workspace=… route=DND".
    //
    // Retrying on `generic` is OPT-IN and off by default, because it is not a
    // free win: a DND-listed Nigerian number cannot be reached on the generic
    // route, so the retry is accepted ("code":"ok"), billed, and only later
    // shows status "Rejected" in /api/sms/inbox. That turns a clean, free
    // failure into a charge plus a send that looks successful. Enable it only
    // when reaching non-DND numbers today matters more than the wasted spend,
    // and treat it as a stopgap until Termii provisions the DND route.
    const detail = String(
      error?.response?.data?.message || error?.message || "",
    );
    const routeMisconfigured =
      error?.response?.status === 422 && /route not configured/i.test(detail);

    if (!routeMisconfigured || payload.channel === "generic") throw error;

    if (!isGenericFallbackEnabled()) {
      throw new Error(
        `Termii route "${payload.channel}" is not provisioned for this workspace. ` +
          `Ask Termii support to enable it, or set TERMII_ALLOW_GENERIC_FALLBACK=true ` +
          `to retry on the generic route (note: generic cannot reach DND-listed ` +
          `numbers and rejected messages are still billed).`,
      );
    }

    console.warn(
      `Termii route "${payload.channel}" is not provisioned; retrying on "generic" ` +
        `(TERMII_ALLOW_GENERIC_FALLBACK=true). DND-listed numbers will still be ` +
        `rejected after billing.`,
    );
    const retry = await axios.post(url, { ...payload, channel: "generic" });
    return retry.data;
  }
};

const smsService = {
  sendSms: async (input: SendSmsInput) => {
    const { to, message, eventId, rsvpId } = input;

    const normalizedTo = normalizePhone(to || "");
    if (!normalizedTo) {
      return { success: false, error: "Missing recipient phone" };
    }

    if (!process.env.TERMII_API_KEY) {
      console.warn("[SMS] TERMII_API_KEY not configured — skipping", { to: normalizedTo, eventId });
      return { success: false, error: "SMS provider not configured" };
    }

    const allowed = await canSendSms(rsvpId);
    if (!allowed) {
      return { success: false, error: "Daily SMS limit reached" };
    }

    try {
      const result = await sendViaTermii(normalizedTo, message);
      const providerMessageId =
        result?.message_id || result?.messageId || result?.data?.message_id || "";

      console.log("[SMS] Termii send success", { to: normalizedTo, providerMessageId, eventId });
      return { success: true, providerMessageId };
    } catch (error: any) {
      const errMsg = error?.response?.data?.message || error?.message || "SMS send failed";
      console.error("[SMS] Termii send failed", { to: normalizedTo, eventId, error: errMsg });
      return { success: false, error: errMsg };
    }
  },
};

export default smsService;
