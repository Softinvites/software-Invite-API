// const resolveProvider = () =>
//   (
//     process.env.WHATSAPP_PROVIDER ||
//     (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "meta")
//   )
//     .toLowerCase()
//     .trim();

// const formatTwilioWhatsAppNumber = (phoneNumber: string) =>
//   phoneNumber.startsWith("whatsapp:") ? phoneNumber : `whatsapp:${phoneNumber}`;

// const looksLikeTwilioContentSid = (value: string) =>
//   /^HX[0-9a-fA-F]{32}$/.test(String(value || "").trim());

// const sanitizeTwilioContentVariableValue = (value: unknown): string => {
//   const normalized = String(value ?? "")
//     .replace(/\s+/g, " ")
//     .replace(/'/g, "’")
//     .trim();

//   return normalized || "—";
// };

// const buildTwilioContentVariables = (templateParams: string[]): string => {
//   // Twilio requires ALL variable indices defined in the template to be present.
//   // Every value must be a non-empty string.
//   const variables: Record<string, string> = {};
//   templateParams.forEach((param, index) => {
//     variables[String(index + 1)] = sanitizeTwilioContentVariableValue(param);
//   });
//   return JSON.stringify(variables);
// };

// const resolveTwilioContentSid = (templateName: string) => {
//   if (looksLikeTwilioContentSid(templateName)) {
//     return templateName;
//   }
//   const envKey = `TWILIO_CONTENT_SID_${templateName
//     .toUpperCase()
//     .replace(/[^A-Z0-9]+/g, "_")}`;
//   return process.env[envKey] || null;
// };

// const sendViaTwilio = async (
//   phoneNumber: string,
//   templateName: string,
//   templateParams: string[],
//   mediaUrl?: string | null,
// ) => {
//   const accountSid = process.env.TWILIO_ACCOUNT_SID;
//   const authToken = process.env.TWILIO_AUTH_TOKEN;
//   const from = process.env.TWILIO_WHATSAPP_FROM;
//   if (!accountSid || !authToken) {
//     throw new Error("Twilio credentials not configured");
//   }
//   if (!from) {
//     throw new Error("TWILIO_WHATSAPP_FROM not configured");
//   }

//   const contentSid = resolveTwilioContentSid(templateName);
//   const payload = new URLSearchParams();
//   payload.set("From", from);
//   payload.set("To", formatTwilioWhatsAppNumber(phoneNumber));
//   if (process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL) {
//     payload.set("StatusCallback", process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL);
//   }
//   if (contentSid) {
//     payload.set("ContentSid", contentSid);
//     payload.set("ContentVariables", buildTwilioContentVariables(templateParams || []));
//   } else {
//     const body = templateParams?.length
//       ? `${templateName}: ${templateParams.join(" | ")}`
//       : templateName;
//     payload.set("Body", body);
//   }

//   const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
//   const response = await fetch(
//     `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
//     {
//       method: "POST",
//       headers: {
//         Authorization: `Basic ${auth}`,
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: payload.toString(),
//     },
//   );
//   const responseBody = await response.json().catch(() => ({}));
//   if (!response.ok) {
//     throw new Error(
//       responseBody?.message ||
//         `Twilio WhatsApp send failed with status ${response.status}`,
//     );
//   }

//   return responseBody?.sid || `twilio_${Date.now()}`;
// };

// const sendViaMeta = async (
//   phoneNumber: string,
//   templateName: string,
//   templateParams: string[],
// ) => {
//   const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
//   const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

//   if (!phoneNumberId || !accessToken) {
//     throw new Error("Meta WhatsApp credentials not configured");
//   }

//   const payload = {
//     messaging_product: "whatsapp",
//     to: phoneNumber,
//     type: "template",
//     template: {
//       name: templateName,
//       language: { code: "en_US" },
//       components: [
//         {
//           type: "body",
//           parameters: (templateParams || []).map((param) => ({
//             type: "text",
//             text: String(param ?? ""),
//           })),
//         },
//       ],
//     },
//   };

//   const response = await fetch(
//     `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
//     {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(payload),
//     },
//   );

//   const responseBody = await response.json().catch(() => ({}));
//   if (!response.ok) {
//     throw new Error(
//       responseBody?.error?.message ||
//         `Meta WhatsApp send failed with status ${response.status}`,
//     );
//   }

//   return responseBody?.messages?.[0]?.id || `meta_${Date.now()}`;
// };

// const whatsappService = {
//   sendTemplateMessage: async (
//     phoneNumber: string,
//     templateName: string,
//     templateParams: string[],
//     rsvpId: string,
//     eventId: string,
//     options: { mediaUrl?: string | null } = {},
//   ) => {
//     if (!phoneNumber) {
//       return { success: false, error: "Missing recipient phone" };
//     }

//     const provider = resolveProvider();
//     try {
//       const messageId =
//         provider === "twilio"
//           ? await sendViaTwilio(
//               phoneNumber,
//               templateName,
//               templateParams,
//               options?.mediaUrl || null,
//             )
//           : await sendViaMeta(phoneNumber, templateName, templateParams);

//       return { success: true, messageId };
//     } catch (error: any) {
//       console.error("RSVP scheduler WhatsApp send failed", {
//         provider,
//         phoneNumber,
//         templateName,
//         rsvpId,
//         eventId,
//         error: error?.message || String(error),
//       });
//       return {
//         success: false,
//         error: error?.message || "Failed to send WhatsApp message",
//       };
//     }
//   },
// };

// export default whatsappService;

import mongoose from "mongoose";
import { WhatsAppMessage } from "../models/whatsappMessage.js";

const resolveProvider = () =>
  (
    process.env.WHATSAPP_PROVIDER ||
    (process.env.TWILIO_ACCOUNT_SID ? "twilio" : "meta")
  )
    .toLowerCase()
    .trim();

const formatTwilioWhatsAppNumber = (phoneNumber: string) =>
  phoneNumber.startsWith("whatsapp:") ? phoneNumber : `whatsapp:${phoneNumber}`;

const looksLikeTwilioContentSid = (value: string) =>
  /^HX[0-9a-fA-F]{32}$/.test(String(value || "").trim());

const sanitizeTwilioContentVariableValue = (value: unknown): string => {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/'/g, "’")
    .trim();

  return normalized || "—";
};

const buildTwilioContentVariables = (templateParams: string[]): string => {
  const variables: Record<string, string> = {};
  templateParams.forEach((param, index) => {
    variables[String(index + 1)] = sanitizeTwilioContentVariableValue(param);
  });
  return JSON.stringify(variables);
};

const resolveTwilioContentSid = async (templateName: string) => {
  if (looksLikeTwilioContentSid(templateName)) {
    return templateName;
  }

  // An approved Manager template is authoritative — check it FIRST so a
  // re-created template (e.g. rsvp_followup) overrides the env-var SID.
  try {
    const { WhatsAppContentTemplate } = await import(
      "../models/whatsappContentTemplate.js"
    );
    const dbDoc = await (WhatsAppContentTemplate as any)
      .findOne({ friendlyName: templateName, approvalStatus: "approved" })
      .select({ contentSid: 1 })
      .lean();
    if (dbDoc?.contentSid) return dbDoc.contentSid;
  } catch {
    /* ignore - fall through to env var */
  }

  // Fallback: hardcoded env-var SID (unchanged behavior when no Manager template).
  const envKey = `TWILIO_CONTENT_SID_${templateName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;
  return process.env[envKey] || null;
};

const sendViaTwilio = async (
  phoneNumber: string,
  templateName: string,
  templateParams: string[],
  mediaUrl?: string | null,
) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  if (!from) {
    throw new Error("TWILIO_WHATSAPP_FROM not configured");
  }

  const contentSid = await resolveTwilioContentSid(templateName);

  const contentVariablesJson = buildTwilioContentVariables(
    templateParams || [],
  );

  console.log("[WhatsApp/Twilio] Preparing send", {
    templateName,
    contentSid: contentSid || "(none - will use Body fallback)",
    paramCount: templateParams.length,
    contentVariables: contentVariablesJson,
    to: phoneNumber,
    from,
  });

  const payload = new URLSearchParams();
  payload.set("From", from);
  payload.set("To", formatTwilioWhatsAppNumber(phoneNumber));
  if (process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL) {
    payload.set(
      "StatusCallback",
      process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,
    );
  }
  if (contentSid) {
    payload.set("ContentSid", contentSid);
    payload.set("ContentVariables", contentVariablesJson);
  } else {
    const body = templateParams?.length
      ? `${templateName}: ${templateParams.join(" | ")}`
      : templateName;
    payload.set("Body", body);
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    },
  );
  const responseBody = await response.json().catch(() => ({}));

  console.log("[WhatsApp/Twilio] Response", {
    status: response.status,
    sid: (responseBody as any)?.sid,
    errorCode: (responseBody as any)?.code,
    errorMessage: (responseBody as any)?.message,
  });

  if (!response.ok) {
    throw new Error(
      (responseBody as any)?.message ||
        `Twilio WhatsApp send failed with status ${response.status}`,
    );
  }

  return (responseBody as any)?.sid || `twilio_${Date.now()}`;
};

const sendViaMeta = async (
  phoneNumber: string,
  templateName: string,
  templateParams: string[],
) => {
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

  const response = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      responseBody?.error?.message ||
        `Meta WhatsApp send failed with status ${response.status}`,
    );
  }

  return responseBody?.messages?.[0]?.id || `meta_${Date.now()}`;
};

const whatsappService = {
  sendTemplateMessage: async (
    phoneNumber: string,
    templateName: string,
    templateParams: string[],
    rsvpId: string,
    eventId: string,
    options: { mediaUrl?: string | null } = {},
  ) => {
    if (!phoneNumber) {
      return { success: false, error: "Missing recipient phone" };
    }

    const provider = resolveProvider();
    try {
      const messageId =
        provider === "twilio"
          ? await sendViaTwilio(
              phoneNumber,
              templateName,
              templateParams,
              options?.mediaUrl || null,
            )
          : await sendViaMeta(phoneNumber, templateName, templateParams);

      // Save to WhatsAppMessage collection so the log is visible in the dashboard.
      // RSVP-admin sends are tied to an RSVP record (not a Guest), so we store
      // the id in `rsvpId` — the status endpoint resolves names from both.
      try {
        await new WhatsAppMessage({
          rsvpId: rsvpId ? new mongoose.Types.ObjectId(rsvpId) : null,
          eventId: new mongoose.Types.ObjectId(eventId),
          templateName,
          providerMessageId: messageId,
          phoneNumber,
          status: "sent",
        }).save();
      } catch (saveErr: any) {
        console.warn(
          "[WhatsApp] Failed to save message record:",
          saveErr?.message,
        );
      }

      return { success: true, messageId };
    } catch (error: any) {
      console.error("RSVP scheduler WhatsApp send failed", {
        provider,
        phoneNumber,
        templateName,
        rsvpId,
        eventId,
        error: error?.message || String(error),
      });

      // Save failed record too so it shows in the log (rsvpId, not guestId,
      // because this lambda only sends to RSVP-collection recipients).
      try {
        await new WhatsAppMessage({
          rsvpId: rsvpId ? new mongoose.Types.ObjectId(rsvpId) : null,
          eventId: new mongoose.Types.ObjectId(eventId),
          templateName,
          providerMessageId: `failed_${Date.now()}`,
          phoneNumber,
          status: "failed",
          errorMessage: error?.message || "Failed to send",
        }).save();
      } catch (saveErr: any) {
        console.warn(
          "[WhatsApp] Failed to save failed message record:",
          saveErr?.message,
        );
      }

      return {
        success: false,
        error: error?.message || "Failed to send WhatsApp message",
      };
    }
  },
};

export default whatsappService;
