import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { buildRawEmail } from "./buildRawEmail.js";
import { connectDB } from "./db.js";
import { EmailMessage } from "./emailMessage.js";

const ses = new SESClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const configurationSetName = process.env.SES_CONFIGURATION_SET_NAME?.trim() || "";

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const sanitizeSesTagValue = (value: unknown) => {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  const sanitized = normalized.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 256);
  return sanitized || null;
};

const buildSesTags = (event: any, trackingId: string) => {
  const tags = [
    { Name: "trackingId", Value: sanitizeSesTagValue(trackingId) },
    { Name: "eventId", Value: sanitizeSesTagValue(event?.eventId) },
    { Name: "rsvpId", Value: sanitizeSesTagValue(event?.rsvpId) },
    { Name: "messageType", Value: sanitizeSesTagValue(event?.messageType) },
  ].filter((tag): tag is { Name: string; Value: string } => Boolean(tag.Value));

  return tags.slice(0, 10);
};

type DiagnosticRecordOptions = {
  set?: Record<string, unknown>;
  setOnInsert?: Record<string, unknown>;
  inc?: Record<string, number>;
  push?: Record<string, unknown>;
};

const buildSetOnInsertDoc = (
  trackingId: string,
  options: DiagnosticRecordOptions,
) => {
  const setDoc = options.set || {};
  const extraSetOnInsert = Object.fromEntries(
    Object.entries(options.setOnInsert || {}).filter(([key]) => !(key in setDoc)),
  );

  const doc: Record<string, unknown> = {
    trackingId,
    channel: "email",
    status: "pending",
    provider: "ses",
    deliveryStatus: "pending",
    guestEmail: "",
    openCount: 0,
    clickCount: 0,
    ...extraSetOnInsert,
  };

  // Avoid ConflictingUpdateOperators errors when the same path is present
  // in both $setOnInsert and $set.
  for (const key of Object.keys(setDoc)) {
    if (key === "trackingId") continue;
    if (key in doc) delete doc[key];
  }

  return doc;
};

const safeRecordDiagnostics = async (
  trackingId: string,
  options: DiagnosticRecordOptions = {},
) => {
  try {
    const updateDoc: Record<string, unknown> = {
      $setOnInsert: buildSetOnInsertDoc(trackingId, options),
    };

    if (options.set && Object.keys(options.set).length > 0) {
      updateDoc.$set = options.set;
    }

    if (options.inc && Object.keys(options.inc).length > 0) {
      updateDoc.$inc = options.inc;
    }

    if (options.push && Object.keys(options.push).length > 0) {
      updateDoc.$push = options.push;
    }

    await connectDB();
    await EmailMessage.findOneAndUpdate(
      { trackingId },
      updateDoc,
      { upsert: true },
    );
  } catch (error) {
    console.warn("Email diagnostics record update failed:", error);
  }
};

const isSesConfigurationSetDoesNotExistError = (error: any) => {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  const code = String(error?.code || error?.Code || "");
  return (
    name === "ConfigurationSetDoesNotExistException" ||
    code === "ConfigurationSetDoesNotExist" ||
    /configuration set .* does not exist/i.test(message)
  );
};

const isSesThrottleError = (error: any) => {
  const message = String(error?.message || "");
  const name = String(error?.name || "");
  const code = String(error?.code || error?.Code || "");

  if (/daily message quota exceeded/i.test(message)) {
    return false;
  }

  return /rate exceeded|maximum sending rate exceeded|throttl/i.test(
    `${name} ${code} ${message}`.toLowerCase(),
  );
};

const sendRawEmailWithRetry = async (
  request: ConstructorParameters<typeof SendRawEmailCommand>[0],
  retries = 6,
) => {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await ses.send(new SendRawEmailCommand(request));
    } catch (error: any) {
      if (!isSesThrottleError(error) || attempt >= retries) {
        throw error;
      }

      const baseDelay = Math.min(30000, 500 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 300);
      const delay = baseDelay + jitter;

      console.warn(
        `SES throttled send (${attempt}/${retries}) for ${request?.Destinations?.[0] || "unknown recipient"}. Retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw new Error("SES send retry loop exited unexpectedly");
};

export const handler = async (event: any) => {
  const trackingId = normalizeString(event?.trackingId) || randomUUID();
  const receivedAt = new Date();
  const recipient = normalizeString(event?.to) || "";
  const subject = normalizeString(event?.subject);
  const messageType = normalizeString(event?.messageType);
  const eventId = normalizeString(event?.eventId);
  const rsvpId = normalizeString(event?.rsvpId);
  const diagnosticContext =
    event?.diagnosticContext && typeof event.diagnosticContext === "object"
      ? event.diagnosticContext
      : null;

  try {
    await safeRecordDiagnostics(
      trackingId,
      {
        set: {
          guestEmail: recipient,
          subject,
          messageType,
          eventId,
          rsvpId,
          provider: "ses",
          deliveryStatus: "pending",
          lastEventType: "lambda_received",
          lastEventAt: receivedAt,
          diagnosticContext,
        },
        setOnInsert: {
          eventId,
          rsvpId,
          guestEmail: recipient,
          subject,
          messageType,
          diagnosticContext,
        },
        inc: {
          deliveryAttempts: 1,
        },
        push: {
          diagnosticEvents: {
            type: "lambda_received",
            timestamp: receivedAt,
            payload: {
              to: recipient,
              subject,
              configurationSetName: configurationSetName || null,
            },
          },
        },
      },
    );

    const from =
      event.from ||
      (event.eventName
        ? `${event.eventName} <info@softinvite.com>`
        : process.env.EMAIL_FROM);

    if (!from) {
      throw new Error("Sender email (from) is required");
    }

    // ✅ LOAD ATTACHMENTS FROM S3 (OPTIONAL)
    const attachments = await Promise.all(
      (event.attachments || []).map(async (file: any) => {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: file.s3Key,
          })
        );

        if (!response.Body) {
          throw new Error(`Unable to read S3 object for ${file.filename}`);
        }

        const byteArray = await response.Body.transformToByteArray();
        const base64 = Buffer.from(byteArray).toString("base64");

        // Prefer explicit file.contentType, fall back to S3 object's ContentType, then generic
        const contentType =
          file.contentType ||
          (response.ContentType as string) ||
          "application/octet-stream";

        return {
          filename: file.filename,
          content: base64,
          contentType,
        };
      })
    );

    const rawMessage = buildRawEmail({
      from, // ✅ FINAL DYNAMIC FROM USED HERE
      to: recipient,
      subject: event.subject,
      htmlContent: event.htmlContent,
      replyTo: event.replyTo,
      attachments,
    });

    const sendRequest: ConstructorParameters<typeof SendRawEmailCommand>[0] = {
      ...(configurationSetName
        ? { ConfigurationSetName: configurationSetName }
        : {}),
      Tags: buildSesTags(event, trackingId),
      RawMessage: { Data: Buffer.from(rawMessage) },
    };

    let response: Awaited<ReturnType<typeof sendRawEmailWithRetry>>;
    try {
      response = await sendRawEmailWithRetry(sendRequest);
    } catch (error: any) {
      if (configurationSetName && isSesConfigurationSetDoesNotExistError(error)) {
        const warnedAt = new Date();
        console.warn(
          `SES configuration set "${configurationSetName}" not found. Retrying without ConfigurationSetName.`,
        );

        await safeRecordDiagnostics(trackingId, {
          set: {
            lastEventType: "configuration_set_missing",
            lastEventAt: warnedAt,
          },
          push: {
            diagnosticEvents: {
              type: "configuration_set_missing",
              timestamp: warnedAt,
              payload: {
                configurationSetName,
                message: String(error?.message || "Configuration set missing"),
              },
            },
          },
        });

        // Backward-compatible: send anyway even if tracking configuration isn't ready yet.
        response = await sendRawEmailWithRetry({
          Tags: sendRequest.Tags,
          RawMessage: sendRequest.RawMessage,
        });
      } else {
        throw error;
      }
    }
    const messageId = normalizeString(response.MessageId);
    const acceptedAt = new Date();

    console.log("✅ SES accepted email", {
      trackingId,
      messageId,
      to: recipient,
      subject,
      configurationSetName: configurationSetName || null,
    });

    await safeRecordDiagnostics(trackingId, {
      set: {
        guestEmail: recipient,
        subject,
        messageType,
        eventId,
        rsvpId,
        provider: "ses",
        providerMessageId: messageId,
        status: "sent",
        deliveryStatus: "accepted",
        sentAt: acceptedAt,
        acceptedAt,
        lastEventType: "accepted",
        lastEventAt: acceptedAt,
        failureReason: null,
      },
      push: {
        diagnosticEvents: {
          type: "accepted",
          timestamp: acceptedAt,
          providerMessageId: messageId,
          payload: {
            messageId,
            configurationSetName: configurationSetName || null,
          },
        },
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Email sent successfully",
        trackingId,
        messageId,
      }),
    };
  } catch (error: any) {
    const failureAt = new Date();
    console.error("❌ Error sending email:", error);

    await safeRecordDiagnostics(trackingId, {
      set: {
        guestEmail: recipient,
        subject,
        messageType,
        eventId,
        rsvpId,
        provider: "ses",
        status: "failed",
        deliveryStatus: "failed",
        failureReason: error.message || "Unknown error",
        lastEventType: "failed",
        lastEventAt: failureAt,
      },
      push: {
        diagnosticEvents: {
          type: "failed",
          timestamp: failureAt,
          payload: {
            error: error.message || "Unknown error",
          },
        },
      },
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to send email",
        error: error.message || "Unknown error",
        trackingId,
      }),
    };
  }
};
