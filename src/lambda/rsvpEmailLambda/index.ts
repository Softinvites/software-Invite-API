import { invokeLambda } from "./lambdaUtils.js";
import { buildRsvpEmail } from "./buildRsvpEmail.js";

const { EMAIL_LAMBDA_FUNCTION_NAME } = process.env;

type Recipient = {
  _id: string;
  guestName: string;
  email?: string;
};

type EventPayload = {
  id: string;
  name: string;
  rsvpSubject?: string;
  date?: string;
  description?: string;
  rsvpMessage?: string;
  rsvpBgColor?: string;
  rsvpAccentColor?: string;
  qrCodeBgColor?: string;
  qrCodeCenterColor?: string;
};

async function safeInvoke(
  functionName: string,
  payload: any,
  asyncInvoke = false,
  retries = 5,
) {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await invokeLambda(functionName, payload, asyncInvoke);
    } catch (err: any) {
      const attempt = i + 1;
      console.error(
        `Invoke failed (${attempt}/${retries}) → ${functionName}`,
        err?.message || err,
      );

      if (attempt >= retries) {
        throw err;
      }

      const baseDelay = Math.min(30000, Math.pow(2, attempt) * 1000);
      const jitter = Math.floor(Math.random() * 300);
      const delay = baseDelay + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export const handler = async (event: any) => {
  try {
    const { baseUrl, recipients = [], event: eventPayload } = event || {};

    if (!EMAIL_LAMBDA_FUNCTION_NAME) {
      return { statusCode: 500, body: "Missing EMAIL_LAMBDA_FUNCTION_NAME" };
    }
    if (!baseUrl || !eventPayload) {
      return { statusCode: 400, body: "Missing baseUrl or event payload" };
    }

    const normalizedBaseUrl = String(baseUrl).replace(/\/$/, "");

    const list = (recipients as Recipient[]).filter((r) => r.email);
    if (!list.length) {
      return { statusCode: 200, body: JSON.stringify({ sent: 0, skipped: 0 }) };
    }

    const eventInfo = eventPayload as EventPayload;
    const headerBg = eventInfo.rsvpBgColor
      ? `rgb(${eventInfo.rsvpBgColor})`
      : eventInfo.qrCodeBgColor
        ? `rgb(${eventInfo.qrCodeBgColor})`
        : "#111827";
    const accent = eventInfo.rsvpAccentColor
      ? `rgb(${eventInfo.rsvpAccentColor})`
      : eventInfo.qrCodeCenterColor
        ? `rgb(${eventInfo.qrCodeCenterColor})`
        : "#111827";
    const subject =
      typeof eventInfo.rsvpSubject === "string" && eventInfo.rsvpSubject.trim()
        ? eventInfo.rsvpSubject.trim()
        : `RSVP for ${eventInfo.name}`;

    const BATCH_SIZE = 25;
    let sent = 0;
    let skipped = 0;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (recipient) => {
          if (!recipient.email) {
            skipped += 1;
            return;
          }
          const yesUrl = `${normalizedBaseUrl}/rsvp/respond/${recipient._id}?status=yes`;
          const noUrl = `${normalizedBaseUrl}/rsvp/respond/${recipient._id}?status=no`;
          const htmlContent = buildRsvpEmail({
            eventName: eventInfo.name,
            eventDate: eventInfo.date,
            eventDescription: eventInfo.description,
            rsvpMessage: eventInfo.rsvpMessage,
            guestName: recipient.guestName,
            yesUrl,
            noUrl,
            headerBg,
            accent,
          });

          await safeInvoke(
            EMAIL_LAMBDA_FUNCTION_NAME,
            {
              to: recipient.email,
              from: `SoftInvites <info@softinvite.com>`,
              subject,
              htmlContent,
            },
            true,
          );
          sent += 1;
        }),
      );

      results.forEach((r) => {
        if (r.status === "rejected") {
          console.error("RSVP email send failed:", r.reason);
        }
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent, skipped, total: list.length }),
    };
  } catch (error: any) {
    console.error("RSVP email lambda error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to process RSVP email batch",
        error: error.message || "Unknown error",
      }),
    };
  }
};
