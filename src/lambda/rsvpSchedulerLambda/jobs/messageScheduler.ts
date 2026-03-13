import { MessageSchedule } from "../models/messageSchedule.js";
import { Event } from "../models/eventmodel.js";
import { RSVP } from "../models/rsvpmodel.js";
import { sendEmail } from "../library/helpers/emailService.js";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference.js";
import whatsappService from "../utils/whatsappService.js";
import smsService from "../utils/smsService.js";
import { EmailTemplate } from "../models/emailTemplate.js";
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
    target === "pending-and-no"
  ) {
    return target;
  }
  return "all";
};

const resolveAudienceFilter = (target: string) => {
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
  return {};
};

const applyTemplateTokens = (html: string, event: any, rsvp: any) =>
  html
    .replace(/{{\s*guestName\s*}}/g, rsvp.guestName || "")
    .replace(/{{\s*eventName\s*}}/g, event.name || "")
    .replace(/{{\s*eventDate\s*}}/g, event.date || "");

const stripHtml = (value: string) =>
  value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

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

const resolveScheduleBody = (
  schedule: any,
  event: any,
  rsvp: any,
  templateHtml?: string | null,
) => {
  if (typeof schedule?.messageBody === "string" && schedule.messageBody.trim()) {
    return applyTemplateTokens(schedule.messageBody, event, rsvp);
  }
  if (templateHtml && templateHtml.trim()) {
    return applyTemplateTokens(templateHtml, event, rsvp);
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
  const schedules = await MessageSchedule.find({
    status: "pending",
    scheduledDate: { $lte: now },
  }).limit(limit);
  summary.scanned = schedules.length;

  for (const schedule of schedules) {
    summary.processed += 1;
    try {
      const event = await Event.findById(schedule.eventId);
      if (!event) {
        await MessageSchedule.findByIdAndUpdate(schedule._id, {
          status: "failed",
          errorMessage: "Event not found",
          lastAttemptAt: new Date(),
          $inc: { attempts: 1 },
        });
        summary.failed += 1;
        continue;
      }

      const audienceFilter = resolveAudienceFilter(schedule.targetAudience);
      const rsvps = await RSVP.find({ eventId: schedule.eventId, ...audienceFilter });
      const baseUrl =
        process.env.RSVP_PUBLIC_BASE_URL ||
        process.env.FRONTEND_URL ||
        "";

      let sentCount = 0;
      const template =
        schedule.templateId && schedule.channel === "email"
          ? await EmailTemplate.findById(schedule.templateId)
          : null;
      const replyTo = (event as any)?.channelConfig?.email?.replyTo;
      const scheduleAttachment =
        schedule.channel === "email"
          ? await resolveScheduleAttachment(schedule)
          : null;
      for (const rsvp of rsvps) {
        const email = rsvp.email || "";
        if (schedule.channel === "email" && !email) continue;
        const channelAllowed = await canUseChannel(String(rsvp._id), schedule.channel);
        if (!channelAllowed) continue;

        if (schedule.channel === "email") {
          const html = await buildScheduleEmailHtml(
            event,
            rsvp,
            schedule,
            baseUrl,
            template?.html || null,
          );
          const subject =
            schedule.messageTitle ||
            template?.subject ||
            `${schedule.messageName || schedule.messageType} - ${event.name}`;
          await sendEmail(
            email,
            subject,
            html,
            `SoftInvites <info@softinvite.com>`,
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
          const whatsappMessage = buildScheduleTextMessage(
            schedule,
            event,
            rsvp,
            template?.html || null,
          );
          await whatsappService.sendTemplateMessage(
            rsvp.phone || "",
            "event_invitation",
            [rsvp.guestName, whatsappMessage],
            String(rsvp._id),
            String(event._id),
          );
          sentCount += 1;
        } else if (schedule.channel === "bulkSms") {
          const smsMessage = buildScheduleTextMessage(
            schedule,
            event,
            rsvp,
            template?.html || null,
          );
          await smsService.sendSms({
            to: rsvp.phone || "",
            message: smsMessage || `${event.name}: You're invited!`,
            eventId: String(event._id),
            rsvpId: String(rsvp._id),
          });
          sentCount += 1;
        }
      }

      await MessageSchedule.findByIdAndUpdate(schedule._id, {
        status: "sent",
        lastAttemptAt: new Date(),
        $inc: { attempts: 1 },
        errorMessage: sentCount ? null : "No recipients sent",
      });
      summary.sent += 1;
    } catch (error: any) {
      await MessageSchedule.findByIdAndUpdate(schedule._id, {
        status: schedule.attempts >= 2 ? "failed" : "pending",
        lastAttemptAt: new Date(),
        $inc: { attempts: 1 },
        errorMessage: error?.message || "Failed to process schedule",
      });
      if (schedule.attempts >= 2) {
        summary.failed += 1;
      } else {
        summary.pendingRetried += 1;
      }
    }
  }
  return summary;
};
