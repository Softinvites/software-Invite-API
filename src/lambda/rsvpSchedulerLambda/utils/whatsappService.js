const resolveProvider = () => (process.env.WHATSAPP_PROVIDER ||
    (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "meta"))
    .toLowerCase()
    .trim();
const formatTwilioWhatsAppNumber = (phoneNumber) => phoneNumber.startsWith("whatsapp:") ? phoneNumber : `whatsapp:${phoneNumber}`;
const looksLikeTwilioContentSid = (value) => /^HX[0-9a-fA-F]{32}$/.test(String(value || "").trim());
const sanitizeTwilioContentVariableValue = (value) => {
    const normalized = String(value ?? "")
        .replace(/\s+/g, " ")
        .replace(/'/g, "’")
        .trim();
    return normalized || "—";
};
const buildTwilioContentVariables = (templateParams) => JSON.stringify(Object.fromEntries((templateParams || []).map((param, index) => [
    String(index + 1),
    sanitizeTwilioContentVariableValue(param),
])));
const resolveTwilioContentSid = (templateName) => {
    if (looksLikeTwilioContentSid(templateName)) {
        return templateName;
    }
    const envKey = `TWILIO_CONTENT_SID_${templateName
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")}`;
    return process.env[envKey] || null;
};
const sendViaTwilio = async (phoneNumber, templateName, templateParams) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;
    if (!accountSid || !authToken) {
        throw new Error("Twilio credentials not configured");
    }
    if (!from) {
        throw new Error("TWILIO_WHATSAPP_FROM not configured");
    }
    const contentSid = resolveTwilioContentSid(templateName);
    const payload = new URLSearchParams();
    payload.set("From", from);
    payload.set("To", formatTwilioWhatsAppNumber(phoneNumber));
    if (process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL) {
        payload.set("StatusCallback", process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL);
    }
    if (contentSid) {
        payload.set("ContentSid", contentSid);
        payload.set("ContentVariables", buildTwilioContentVariables(templateParams || []));
    }
    else {
        const body = templateParams?.length
            ? `${templateName}: ${templateParams.join(" | ")}`
            : templateName;
        payload.set("Body", body);
    }
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: payload.toString(),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(responseBody?.message ||
            `Twilio WhatsApp send failed with status ${response.status}`);
    }
    return responseBody?.sid || `twilio_${Date.now()}`;
};
const sendViaMeta = async (phoneNumber, templateName, templateParams) => {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) {
        throw new Error("Meta WhatsApp credentials not configured");
    }
    const payload = {
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "template",
        template: {
            name: templateName,
            language: { code: "en_US" },
            components: [
                {
                    type: "body",
                    parameters: (templateParams || []).map((param) => ({
                        type: "text",
                        text: String(param ?? ""),
                    })),
                },
            ],
        },
    };
    const response = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(responseBody?.error?.message ||
            `Meta WhatsApp send failed with status ${response.status}`);
    }
    return responseBody?.messages?.[0]?.id || `meta_${Date.now()}`;
};
const whatsappService = {
    sendTemplateMessage: async (phoneNumber, templateName, templateParams, rsvpId, eventId) => {
        if (!phoneNumber) {
            return { success: false, error: "Missing recipient phone" };
        }
        const provider = resolveProvider();
        try {
            const messageId = provider === "twilio"
                ? await sendViaTwilio(phoneNumber, templateName, templateParams)
                : await sendViaMeta(phoneNumber, templateName, templateParams);
            return { success: true, messageId };
        }
        catch (error) {
            console.error("RSVP scheduler WhatsApp send failed", {
                provider,
                phoneNumber,
                templateName,
                rsvpId,
                eventId,
                error: error?.message || String(error),
            });
            return {
                success: false,
                error: error?.message || "Failed to send WhatsApp message",
            };
        }
    },
};
export default whatsappService;
