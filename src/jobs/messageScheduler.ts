import cron from "node-cron";
import { MessageSchedule } from "../models/messageSchedule";
import { Event } from "../models/eventmodel";
import { buildEventEmailFrom } from "../utils/emailSender";
import { RSVP } from "../models/rsvpmodel";
import { sendEmail } from "../library/helpers/emailService";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference";
import whatsappService from "../utils/whatsappService";
import smsService from "../utils/smsService";
import { EmailTemplate } from "../models/emailTemplate";
import { WhatsAppTemplate } from "../models/WhatsAppTemplate";
import {
  buildWhatsAppTemplateParams,
  getDefaultWhatsAppTemplateName,
} from "../utils/whatsappTemplateParams";
import { loadDbTemplateByName } from "../utils/loadDbTemplate";
import fetch from "node-fetch";

export type SchedulerRunOptions = {
  limit?: number;
  now?: Date;
};

export type SchedulerRunSummary = {
  scanned: number;
  processed: number;
  sent: number;
  failed: number;
  pendingRetried: number;
};

let schedulerStarted = false;

const DEFAULT_ATTENDANCE_LABEL = "Will you attend?";
const DEFAULT_ATTENDANCE_YES_LABEL = "YES, I WILL ATTEND";
const DEFAULT_ATTENDANCE_NO_LABEL = "UNABLE TO ATTEND";

const normalizeTargetAudience = (target: string) => {
  if (target === "non-responders") return "pending";
  if (target === "pending-no" || target === "pending_and_no") {
    return "pending-and-no";
  }
  if (
    target === "all" ||
    target === "responders" ||
    target === "yes" ||
    target === "no" ||
    target === "pending" ||
    target === "pending-and-no" ||
    target === "tag"
  ) {
    return target;
  }
  return "all";
};

const normalizeTargetTag = (value?: string | null) => {
  const trimmed = String(value || "").replace(/\s+/g, " ").trim();
  return trimmed || null;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildExactTagPattern = (value: string) =>
  new RegExp(
    `^\\s*${value.split(" ").map(escapeRegex).join("\\s+")}\\s*$`,
    "i",
  );

const resolveAudienceFilter = (target: string, targetTag?: string | null) => {
  const normalizedTarget = normalizeTargetAudience(target);
  if (normalizedTarget === "pending") {
    return { attendanceStatus: "pending" };
  }
  if (normalizedTarget === "responders") {
    return { attendanceStatus: { $in: ["yes", "no"] } };
  }
  if (normalizedTarget === "yes") {
    return { attendanceStatus: "yes" };
  }
  if (normalizedTarget === "no") {
    return { attendanceStatus: "no" };
  }
  if (normalizedTarget === "pending-and-no") {
    return { attendanceStatus: { $in: ["pending", "no"] } };
  }
  if (normalizedTarget === "tag") {
    const normalizedTag = normalizeTargetTag(targetTag);
    return normalizedTag ? { tag: buildExactTagPattern(normalizedTag) } : { _id: null };
  }
  return {};
};

const applyTemplateTokens = (html: string, event: any, rsvp: any) =>
  html
    .replace(/{{\s*guestName\s*}}/g, rsvp.guestName || "")
    .replace(/{{\s*eventName\s*}}/g, event.name || "")
    .replace(/{{\s*eventDate\s*}}/g, event.date || "");

const stripHtml = (value: string) =>
  value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const IMAGE_ATTACHMENT_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const isImageAttachmentUrl = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /\.(png|jpe?g|webp|gif)([?#].*)?$/i.test(raw);
};

const resolveWhatsAppHeaderMediaUrl = (attachment: any) => {
  const url = String(attachment?.url || "").trim();
  if (!url) return "";

  const contentType = String(attachment?.contentType || "")
    .trim()
    .toLowerCase();
  if (contentType && IMAGE_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
    return url;
  }

  return isImageAttachmentUrl(url) ? url : "";
};

const buildDefaultScheduleMessage = (event: any, rsvp: any, schedule: any) => {
  let message =
    (event as any).rsvpMessage || event.description || "You're invited!";
  if (schedule.messageType === "reminder") {
    message = `Reminder: ${message}`;
  } else if (schedule.messageType === "thankyou") {
    message =
      rsvp.attendanceStatus === "yes"
        ? "Thanks for confirming! We look forward to seeing you."
        : "Thank you for your response.";
  } else if (schedule.messageType === "custom" && schedule.messageName) {
    message = `${schedule.messageName}: ${message}`;
  }
  return message;
};

const hasExplicitScheduleBody = (schedule: any) =>
  typeof schedule?.messageBody === "string" && schedule.messageBody.trim().length > 0;

const requiresExplicitScheduleBody = (schedule: any) =>
  schedule?.servicePackage === "full-rsvp" || schedule?.messageType === "custom";

const resolveScheduleBody = (
  schedule: any,
  event: any,
  rsvp: any,
  templateHtml?: string | null,
) => {
  if (hasExplicitScheduleBody(schedule)) {
    return applyTemplateTokens(schedule.messageBody, event, rsvp);
  }
  if (templateHtml && templateHtml.trim()) {
    return applyTemplateTokens(templateHtml, event, rsvp);
  }
  if (requiresExplicitScheduleBody(schedule)) {
    return "";
  }
  return applyTemplateTokens(buildDefaultScheduleMessage(event, rsvp, schedule), event, rsvp);
};

const buildScheduleTextMessage = (
  schedule: any,
  event: any,
  rsvp: any,
  templateHtml?: string | null,
) => stripHtml(resolveScheduleBody(schedule, event, rsvp, templateHtml));

const inferAttachmentFilename = (url: string, contentType?: string | null) => {
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").pop() || "";
    if (raw) return decodeURIComponent(raw);
  } catch {
    // fallback below
  }

  const extension =
    contentType === "application/pdf"
      ? "pdf"
      : contentType?.includes("png")
        ? "png"
        : contentType?.includes("jpeg")
          ? "jpg"
          : contentType?.includes("html")
            ? "html"
            : "bin";
  return `attachment.${extension}`;
};

const resolveScheduleAttachment = async (schedule: any) => {
  const url =
    typeof schedule?.attachment?.url === "string"
      ? schedule.attachment.url.trim()
      : "";
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Attachment fetch failed (${response.status})`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    const detectedType = response.headers.get("content-type");
    const contentType =
      (typeof schedule?.attachment?.contentType === "string" &&
        schedule.attachment.contentType.trim()) ||
      detectedType ||
      "application/octet-stream";
    const filename =
      (typeof schedule?.attachment?.filename === "string" &&
        schedule.attachment.filename.trim()) ||
      inferAttachmentFilename(url, contentType);

    return { filename, content, contentType };
  } catch (error) {
    console.error("Failed to resolve schedule attachment:", error);
    return null;
  }
};

const buildScheduleEmailHtml = async (
  event: any,
  rsvp: any,
  schedule: any,
  baseUrl: string,
  templateHtml?: string | null,
) => {
  const headerBg = (event as any).rsvpBgColor
    ? `rgb(${(event as any).rsvpBgColor})`
    : (event as any).qrCodeBgColor
      ? `rgb(${(event as any).qrCodeBgColor})`
      : "#111827";
  const accent = (event as any).rsvpAccentColor
    ? `rgb(${(event as any).rsvpAccentColor})`
    : (event as any).qrCodeCenterColor
      ? `rgb(${(event as any).qrCodeCenterColor})`
      : "#111827";
  const safeBase = typeof baseUrl === "string" ? baseUrl.replace(/\/$/, "") : "";
  const attendanceEnabled =
    schedule?.includeResponseButtons !== false && Boolean(safeBase);
  const yesUrl = attendanceEnabled
    ? `${safeBase}/rsvp/respond/${rsvp._id}?status=yes`
    : "";
  const noUrl = attendanceEnabled
    ? `${safeBase}/rsvp/respond/${rsvp._id}?status=no`
    : "";

  const title =
    schedule.messageTitle ||
    schedule.messageName ||
    schedule.messageType ||
    "RSVP Update";
  const message = resolveScheduleBody(schedule, event, rsvp, templateHtml);

  const buttons =
    schedule.messageType === "thankyou" || !yesUrl || !noUrl
      ? ""
      : `
        <p style="font-size:14px;margin:0 0 12px 0;">${DEFAULT_ATTENDANCE_LABEL}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
          <a href="${yesUrl}" style="display:inline-block;background:${headerBg};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${DEFAULT_ATTENDANCE_YES_LABEL}</a>
          <a href="${noUrl}" style="display:inline-block;background:${accent};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">${DEFAULT_ATTENDANCE_NO_LABEL}</a>
        </div>`;

  return `
    <div style="font-family:'Segoe UI','Arial',sans-serif;background:#f7f8fc;padding:24px 10px;line-height:1.6;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.08);">
        <div style="background:${headerBg};padding:24px 20px;text-align:center;color:#fff;">
          <h1 style="margin:0 0 6px 0;font-size:22px;">${event.name}</h1>
          <p style="margin:0;font-size:14px;">${event.date}</p>
        </div>
        <div style="padding:24px 20px;">
          <p style="font-size:15px;margin:0 0 16px 0;">Dear ${rsvp.guestName},</p>
          <h2 style="margin:0 0 10px 0;font-size:20px;color:#111827;">${title}</h2>
          <div style="font-size:14px;color:#4a5568;line-height:1.7;margin:0 0 20px 0;">
            ${message}
          </div>
          ${buttons}
        </div>
      </div>
    </div>
  `;
};

const canUseChannel = async (rsvpId: string, channel: string) => {
  if (channel === "email") return true;
  const prefs = await RSVPChannelPreference.findOne({ rsvpId });
  if (!prefs) return channel === "email";
  if (channel === "whatsapp") return prefs.whatsappOptIn === true;
  if (channel === "bulkSms") return prefs.smsOptIn === true;
  return true;
};

export const processPendingSchedules = async (
  options: SchedulerRunOptions = {},
): Promise<SchedulerRunSummary> => {
  const now = options.now || new Date();
  const requestedLimit = Number(options.limit || 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(500, Math.trunc(requestedLimit)))
    : 50;
  const summary: SchedulerRunSummary = {
    scanned: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    pendingRetried: 0,
  };

  // Fetch IDs of pending schedules first, then atomically claim each one
  // by flipping status to "processing". This prevents concurrent lambda
  // invocations from picking up the same schedule and sending duplicates.
  const pendingIds = await MessageSchedule.find({
    status: "pending",
    scheduledDate: { $lte: now },
  })
    .limit(limit)
    .select("_id")
    .lean();

  summary.scanned = pendingIds.length;

  for (const { _id } of pendingIds) {
    // Atomically claim: only proceed if we successfully transition pending → processing.
    // If another invocation already claimed it, findOneAndUpdate returns null — skip it.
    const schedule = await MessageSchedule.findOneAndUpdate(
      { _id, status: "pending" },
      { $set: { status: "processing", lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
      { new: true },
    );
    if (!schedule) continue; // already claimed by another invocation

    summary.processed += 1;
    try {
      const event = await Event.findById(schedule.eventId);
      if (!event) {
        await MessageSchedule.findByIdAndUpdate(schedule._id, {
          status: "failed",
          errorMessage: "Event not found",
          lastAttemptAt: new Date(),
        });
        summary.failed += 1;
        continue;
      }

      const audienceFilter = resolveAudienceFilter(
        schedule.targetAudience,
        schedule.targetTag,
      );
      // Only filter by createdAt — not updatedAt — so guests who responded
      // after the schedule was created are still included.
      const rsvps = await RSVP.find({
        eventId: schedule.eventId,
        ...audienceFilter,
        createdAt: { $lte: schedule.scheduledDate },
      });
      const baseUrl =
        process.env.RSVP_PUBLIC_BASE_URL ||
        process.env.FRONTEND_URL ||
        "";

      let sentCount = 0;
      // templateId may be a Mongo ObjectId string (legacy per-event template)
      // OR a friendlyName like "rsvp_stalo" (Content Manager template).
      // Only call findById when the value actually looks like an ObjectId.
      const isObjectIdLike = (v: any) =>
        typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
      const emailTemplate =
        schedule.templateId &&
        schedule.channel === "email" &&
        isObjectIdLike(schedule.templateId)
          ? await EmailTemplate.findById(schedule.templateId as any)
          : null;
      const whatsappTemplate =
        schedule.templateId &&
        schedule.channel === "whatsapp" &&
        isObjectIdLike(schedule.templateId)
          ? await WhatsAppTemplate.findById(schedule.templateId as any)
          : null;
      const replyTo = (event as any)?.channelConfig?.email?.replyTo;
      const scheduleAttachment =
        schedule.channel === "email"
          ? await resolveScheduleAttachment(schedule)
          : null;

      if (requiresExplicitScheduleBody(schedule) && !hasExplicitScheduleBody(schedule)) {
        await MessageSchedule.findByIdAndUpdate(schedule._id, {
          status: "failed",
          lastAttemptAt: new Date(),
          errorMessage: "Message body is empty; schedule not sent",
        });
        summary.failed += 1;
        continue;
      }

      for (const rsvp of rsvps) {
        const email = rsvp.email || "";
        if (schedule.channel === "email" && !email) continue;
        if (schedule.channel === "whatsapp" && !String(rsvp.phone || "").trim()) {
          continue;
        }
        const channelAllowed = await canUseChannel(String(rsvp._id), schedule.channel);
        if (!channelAllowed) continue;

        if (schedule.channel === "email") {
          const html = await buildScheduleEmailHtml(
            event,
            rsvp,
            schedule,
            baseUrl,
            emailTemplate?.html || null,
          );
          const subject =
            schedule.messageTitle ||
            emailTemplate?.subject ||
            `${schedule.messageName || schedule.messageType} - ${event.name}`;
          await sendEmail(
            email,
            subject,
            html,
            buildEventEmailFrom(event),
            scheduleAttachment ? [scheduleAttachment] : undefined,
            {
              eventId: String(event._id),
              rsvpId: String(rsvp._id),
              messageType: schedule.messageType,
              replyTo,
            },
          );
          sentCount += 1;
        } else if (schedule.channel === "whatsapp") {
          // templateId can be:
          //   1) a Mongo ObjectId of a legacy per-event WhatsAppTemplate doc
          //      (resolved into whatsappTemplate above), or
          //   2) a Content Manager friendlyName like "rsvp_stalo" — used as
          //      the templateName directly, no DB doc needed.
          const directTemplateName =
            !isObjectIdLike(schedule.templateId) &&
            typeof schedule.templateId === "string" &&
            schedule.templateId.trim().length > 0
              ? schedule.templateId.trim()
              : null;
          const templateName =
            whatsappTemplate?.name ||
            directTemplateName ||
            getDefaultWhatsAppTemplateName();
          const rsvpLink =
            rsvp?.token && baseUrl
              ? `${baseUrl.replace(/\/$/, "")}/rsvp/${rsvp.token}`
              : "";
          const scheduleHeaderMediaUrl = resolveWhatsAppHeaderMediaUrl(
            schedule?.attachment,
          );
          const bucket = String(process.env.S3_BUCKET || "").trim();
          const region = String(process.env.AWS_REGION || "").trim();
          const eventIdValue = String(event?._id || "").trim();
          const qrGuestId = String((rsvp as any)?.guestId || rsvp?._id || "").trim();
          const qrPassUrl =
            bucket && region && eventIdValue && qrGuestId
              ? `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/email_png/${eventIdValue}/${qrGuestId}.png`
              : "";
          const passUrl =
            /^rsvp_followup/i.test(templateName) || /^wedding_invite/i.test(templateName)
              ? qrPassUrl || rsvpLink || event.iv || ""
              : rsvpLink || event.iv || "";
          // For wedding_invite, {{8}} (header media path) and {{9}} (pass URL suffix)
          // are body variables — no separate header component should be sent.
          const eventIvForParams =
            /^wedding_invite/i.test(templateName)
              ? scheduleHeaderMediaUrl || (event as any).iv || null
              : null;
          const dbTemplateInfo = await loadDbTemplateByName(templateName);
          // NOTE: this path is RSVP-driven and the RSVP model has no TableNo,
          // so guest_table_no resolves to "TBA" here. Table numbers only reach
          // guest-driven sends (whatsappController / sendWhatsAppLambda).
          const templateParams = buildWhatsAppTemplateParams({
            templateName,
            recipientName: rsvp.guestName || "Guest",
            eventName: event.name || "Our Event",
            location: event.location || "TBA",
            eventDate: event.date || "TBA",
            passUrl,
            eventIv: eventIvForParams,
            headerValue: scheduleHeaderMediaUrl || null,
            templateVariables: (schedule as any)?.templateVariables || null,
            customDefinition: dbTemplateInfo?.variableDefinitions || null,
          });

          // Never pass a mediaUrl for wedding_invite — the image is a body variable ({{8}}),
          // not a header component. Passing it would cause "Content Variables parameter is invalid".
          const waResult = await whatsappService.sendTemplateMessage(
            rsvp.phone || "",
            templateName,
            templateParams,
            String(rsvp._id),
            String(event._id),
            {},
          );

          if (waResult.success) {
            sentCount += 1;
          }
        } else if (schedule.channel === "bulkSms") {
          const smsMessage = buildScheduleTextMessage(
            schedule,
            event,
            rsvp,
            emailTemplate?.html || null,
          );
          const smsResult = await smsService.sendSms({
            to: rsvp.phone || "",
            message: smsMessage || `${event.name}: You're invited!`,
            eventId: String(event._id),
            rsvpId: String(rsvp._id),
          });
          if (smsResult.success) sentCount += 1;
        }
      }

      // Mark as sent — attempts was already incremented during the atomic claim.
      await MessageSchedule.findByIdAndUpdate(schedule._id, {
        status: "sent",
        lastAttemptAt: new Date(),
        errorMessage: sentCount ? null : "No recipients sent",
      });
      summary.sent += 1;
    } catch (error: any) {
      // attempts was already incremented during the atomic claim above.
      // Only retry once (attempts === 1 means first try just failed).
      const shouldRetry = schedule.attempts <= 1;
      await MessageSchedule.findByIdAndUpdate(schedule._id, {
        status: shouldRetry ? "pending" : "failed",
        lastAttemptAt: new Date(),
        errorMessage: error?.message || "Failed to process schedule",
      });
      if (shouldRetry) {
        summary.pendingRetried += 1;
      } else {
        summary.failed += 1;
      }
    }
  }
  return summary;
};

export const startMessageScheduler = () => {
  if (schedulerStarted) {
    return;
  }
  if (process.env.RUN_SCHEDULER === "false") {
    return;
  }
  schedulerStarted = true;
  cron.schedule("*/5 * * * *", async () => {
    try {
      await processPendingSchedules();
    } catch (error) {
      console.error("Scheduler run failed:", error);
    }
  });
};
