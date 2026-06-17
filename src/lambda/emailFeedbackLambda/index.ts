import { randomUUID } from "crypto";
import { connectDB } from "./db.js";
import { EmailMessage } from "./emailMessage.js";

type NormalizedFeedbackEvent = {
  trackingId: string | null;
  providerMessageId: string | null;
  guestEmail: string | null;
  eventId: string | null;
  rsvpId: string | null;
  messageType: string | null;
  eventType: string;
  occurredAt: Date;
  status: "pending" | "sent" | "failed";
  deliveryStatus:
    | "pending"
    | "accepted"
    | "delivered"
    | "bounced"
    | "complained"
    | "rejected"
    | "failed";
  failureReason: string | null;
  payload: Record<string, unknown>;
};

const configurationSetName = process.env.SES_CONFIGURATION_SET_NAME?.trim() || "";

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseDate = (value: unknown, fallback?: Date) => {
  if (typeof value !== "string") {
    return fallback || new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback || new Date() : parsed;
};

const getTagValue = (
  tags: Record<string, unknown> | null | undefined,
  key: string,
) => {
  if (!tags || typeof tags !== "object") return null;

  const rawValue = (tags as Record<string, unknown>)[key];
  if (Array.isArray(rawValue)) {
    return normalizeString(rawValue[0]);
  }

  return normalizeString(rawValue);
};

const buildFailureReason = (eventType: string, detail: Record<string, any>) => {
  if (eventType === "bounced") {
    const bouncedRecipient = Array.isArray(detail?.bounce?.bouncedRecipients)
      ? detail.bounce.bouncedRecipients[0]
      : null;
    const diagnosticCode = normalizeString(bouncedRecipient?.diagnosticCode);
    const bounceType = normalizeString(detail?.bounce?.bounceType);
    const bounceSubType = normalizeString(detail?.bounce?.bounceSubType);
    return [bounceType, bounceSubType, diagnosticCode].filter(Boolean).join(" | ") || null;
  }

  if (eventType === "complained") {
    const complaintFeedbackType = normalizeString(
      detail?.complaint?.complaintFeedbackType,
    );
    const complaintSubType = normalizeString(detail?.complaint?.complaintSubType);
    return [complaintFeedbackType, complaintSubType].filter(Boolean).join(" | ") || "Complaint received";
  }

  if (eventType === "rejected") {
    return (
      normalizeString(detail?.reject?.reason) ||
      normalizeString(detail?.failure?.errorMessage) ||
      "Email rejected by SES"
    );
  }

  if (eventType === "failed") {
    return normalizeString(detail?.failure?.errorMessage) || "Email failed before delivery";
  }

  if (eventType === "delivery_delayed") {
    return normalizeString(detail?.deliveryDelay?.delayType) || "Email delivery delayed";
  }

  return null;
};

const mapEventType = (rawType: string | null) => {
  switch ((rawType || "").toLowerCase()) {
    case "send":
    case "email sent":
      return {
        eventType: "sent",
        status: "sent" as const,
        deliveryStatus: "accepted" as const,
      };
    case "delivery":
    case "email delivered":
      return {
        eventType: "delivered",
        status: "sent" as const,
        deliveryStatus: "delivered" as const,
      };
    case "bounce":
    case "email bounced":
      return {
        eventType: "bounced",
        status: "failed" as const,
        deliveryStatus: "bounced" as const,
      };
    case "complaint":
    case "email complaint received":
      return {
        eventType: "complained",
        status: "sent" as const,
        deliveryStatus: "complained" as const,
      };
    case "reject":
    case "email rejected":
      return {
        eventType: "rejected",
        status: "failed" as const,
        deliveryStatus: "rejected" as const,
      };
    case "deliverydelay":
    case "delivery delay":
    case "email delivery delayed":
      return {
        eventType: "delivery_delayed",
        status: "sent" as const,
        deliveryStatus: "pending" as const,
      };
    case "rendering failure":
    case "email rendering failed":
      return {
        eventType: "failed",
        status: "failed" as const,
        deliveryStatus: "failed" as const,
      };
    default:
      return {
        eventType: "accepted",
        status: "sent" as const,
        deliveryStatus: "accepted" as const,
      };
  }
};

const shouldProcessConfigurationSet = (detail: Record<string, any>) => {
  if (!configurationSetName) return true;

  const tags = detail?.mail?.tags;
  const eventConfigurationSet =
    getTagValue(tags, "ses:configuration-set") ||
    getTagValue(tags, "configurationSet");

  if (!eventConfigurationSet) {
    console.warn("Skipping SES feedback event without configuration set tag", {
      configuredConfigurationSet: configurationSetName,
      providerMessageId: normalizeString(detail?.mail?.messageId),
    });
    return false;
  }

  return eventConfigurationSet === configurationSetName;
};

const normalizeEventBridgeEvent = (event: any): NormalizedFeedbackEvent[] => {
  const detail = event?.detail;
  if (!detail || typeof detail !== "object") return [];
  if (!shouldProcessConfigurationSet(detail)) return [];

  const eventTypeSource =
    normalizeString(detail?.eventType) || normalizeString(event?.["detail-type"]);
  const mapped = mapEventType(eventTypeSource);
  const mail = detail?.mail || {};
  const tags = mail?.tags || {};
  const occurredAt = parseDate(
    detail?.delivery?.timestamp ||
      detail?.bounce?.timestamp ||
      detail?.complaint?.timestamp ||
      detail?.deliveryDelay?.timestamp ||
      detail?.failure?.timestamp ||
      event?.time ||
      mail?.timestamp,
  );

  return [
    {
      trackingId: getTagValue(tags, "trackingId"),
      providerMessageId: normalizeString(mail?.messageId),
      guestEmail: Array.isArray(mail?.destination)
        ? normalizeString(mail.destination[0])
        : null,
      eventId: getTagValue(tags, "eventId"),
      rsvpId: getTagValue(tags, "rsvpId"),
      messageType: getTagValue(tags, "messageType"),
      eventType: mapped.eventType,
      occurredAt,
      status: mapped.status,
      deliveryStatus: mapped.deliveryStatus,
      failureReason: buildFailureReason(mapped.eventType, detail),
      payload: {
        source: event?.source || "aws.ses",
        detailType: event?.["detail-type"] || null,
        detail,
      },
    },
  ];
};

const normalizeSnsMessage = (payload: any): NormalizedFeedbackEvent[] => {
  if (!payload || typeof payload !== "object") return [];
  if (!shouldProcessConfigurationSet(payload)) return [];

  const rawType =
    normalizeString(payload?.notificationType) || normalizeString(payload?.eventType);
  const mapped = mapEventType(rawType);
  const mail = payload?.mail || {};
  const tags = mail?.tags || {};
  const occurredAt = parseDate(
    payload?.delivery?.timestamp ||
      payload?.bounce?.timestamp ||
      payload?.complaint?.timestamp ||
      payload?.deliveryDelay?.timestamp ||
      mail?.timestamp,
  );

  return [
    {
      trackingId: getTagValue(tags, "trackingId"),
      providerMessageId: normalizeString(mail?.messageId),
      guestEmail: Array.isArray(mail?.destination)
        ? normalizeString(mail.destination[0])
        : null,
      eventId: getTagValue(tags, "eventId"),
      rsvpId: getTagValue(tags, "rsvpId"),
      messageType: getTagValue(tags, "messageType"),
      eventType: mapped.eventType,
      occurredAt,
      status: mapped.status,
      deliveryStatus: mapped.deliveryStatus,
      failureReason: buildFailureReason(mapped.eventType, payload),
      payload: {
        source: "sns",
        notificationType: rawType,
        detail: payload,
      },
    },
  ];
};

const normalizeIncomingEvents = (event: any): NormalizedFeedbackEvent[] => {
  if (Array.isArray(event?.Records)) {
    return event.Records.flatMap((record: any) => {
      const message = record?.Sns?.Message || record?.body;
      if (!message) return [];

      try {
        return normalizeSnsMessage(
          typeof message === "string" ? JSON.parse(message) : message,
        );
      } catch (error) {
        console.warn("Failed to parse SNS email feedback message", error);
        return [];
      }
    });
  }

  if (event?.source === "aws.ses") {
    return normalizeEventBridgeEvent(event);
  }

  if (event?.notificationType || event?.mail) {
    return normalizeSnsMessage(event);
  }

  return [];
};

const applyDeliveryTimestamps = (normalized: NormalizedFeedbackEvent) => {
  switch (normalized.eventType) {
    case "sent":
    case "accepted":
      return {
        acceptedAt: normalized.occurredAt,
        sentAt: normalized.occurredAt,
      };
    case "delivered":
      return {
        deliveredAt: normalized.occurredAt,
      };
    case "bounced":
      return {
        bouncedAt: normalized.occurredAt,
      };
    case "complained":
      return {
        complainedAt: normalized.occurredAt,
      };
    default:
      return {};
  }
};

const persistFeedbackEvent = async (normalized: NormalizedFeedbackEvent) => {
  const fallbackTrackingId =
    normalized.trackingId || normalized.providerMessageId || randomUUID();
  const query = normalized.trackingId
    ? { trackingId: normalized.trackingId }
    : normalized.providerMessageId
      ? { providerMessageId: normalized.providerMessageId }
      : { trackingId: fallbackTrackingId };

  await EmailMessage.findOneAndUpdate(
    query,
    {
      $setOnInsert: {
        trackingId: fallbackTrackingId,
        channel: "email",
        openCount: 0,
        clickCount: 0,
      },
      $set: {
        provider: "ses",
        providerMessageId: normalized.providerMessageId,
        guestEmail: normalized.guestEmail || "",
        eventId: normalized.eventId,
        rsvpId: normalized.rsvpId,
        messageType: normalized.messageType,
        status: normalized.status,
        deliveryStatus: normalized.deliveryStatus,
        lastEventType: normalized.eventType,
        lastEventAt: normalized.occurredAt,
        failureReason: normalized.failureReason,
        ...applyDeliveryTimestamps(normalized),
      },
      $push: {
        diagnosticEvents: {
          type: normalized.eventType,
          timestamp: normalized.occurredAt,
          providerMessageId: normalized.providerMessageId,
          payload: normalized.payload,
        },
      },
    },
    { upsert: true },
  );
};

export const handler = async (event: any) => {
  try {
    const normalizedEvents = normalizeIncomingEvents(event);
    if (!normalizedEvents.length) {
      console.warn("No recognized SES feedback events to process", {
        source: event?.source || null,
        detailType: event?.["detail-type"] || null,
        hasRecords: Array.isArray(event?.Records),
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No recognized SES feedback events to process",
          processed: 0,
        }),
      };
    }

    await connectDB();
    for (const normalized of normalizedEvents) {
      await persistFeedbackEvent(normalized);
      console.log("✅ SES feedback event recorded", {
        trackingId: normalized.trackingId,
        providerMessageId: normalized.providerMessageId,
        eventType: normalized.eventType,
        guestEmail: normalized.guestEmail,
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "SES feedback processed successfully",
        processed: normalizedEvents.length,
      }),
    };
  } catch (error: any) {
    console.error("❌ SES feedback processing failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to process SES feedback",
        error: error?.message || "Unknown error",
      }),
    };
  }
};
