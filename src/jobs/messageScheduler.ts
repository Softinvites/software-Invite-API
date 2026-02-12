import cron from "node-cron";
import { MessageSchedule } from "../models/messageSchedule";
import { Event } from "../models/eventmodel";
import { RSVP } from "../models/rsvpmodel";
import { sendEmail } from "../library/helpers/emailService";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference";
import whatsappService from "../utils/whatsappService";
import smsService from "../utils/smsService";
import { EmailTemplate } from "../models/emailTemplate";

const resolveAudienceFilter = (target: string) => {
  if (target === "non-responders" || target === "pending") {
    return { attendanceStatus: "pending" };
  }
  if (target === "responders") {
    return { attendanceStatus: { $in: ["yes", "no"] } };
  }
  if (target === "yes") {
    return { attendanceStatus: "yes" };
  }
  if (target === "no") {
    return { attendanceStatus: "no" };
  }
  return {};
};

const applyTemplateTokens = (html: string, event: any, rsvp: any) =>
  html
    .replace(/{{\s*guestName\s*}}/g, rsvp.guestName || "")
    .replace(/{{\s*eventName\s*}}/g, event.name || "")
    .replace(/{{\s*eventDate\s*}}/g, event.date || "");

const buildScheduleEmailHtml = async (
  event: any,
  rsvp: any,
  schedule: any,
  baseUrl: string,
) => {
  if (schedule.templateId) {
    const template = await EmailTemplate.findById(schedule.templateId);
    if (template?.html) {
      return applyTemplateTokens(template.html, event, rsvp);
    }
  }
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

  const yesUrl = `${baseUrl.replace(/\/$/, "")}/rsvp/respond/${rsvp._id}?status=yes`;
  const noUrl = `${baseUrl.replace(/\/$/, "")}/rsvp/respond/${rsvp._id}?status=no`;

  let message = event.rsvpMessage || event.description || "You're invited!";
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

  const buttons =
    schedule.messageType === "thankyou"
      ? ""
      : `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
          <a href="${yesUrl}" style="display:inline-block;background:${headerBg};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Yes</a>
          <a href="${noUrl}" style="display:inline-block;background:${accent};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">No</a>
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

export const processPendingSchedules = async () => {
  const now = new Date();
  const schedules = await MessageSchedule.find({
    status: "pending",
    scheduledDate: { $lte: now },
  }).limit(50);

  for (const schedule of schedules) {
    try {
      const event = await Event.findById(schedule.eventId);
      if (!event) {
        await MessageSchedule.findByIdAndUpdate(schedule._id, {
          status: "failed",
          errorMessage: "Event not found",
          lastAttemptAt: new Date(),
          $inc: { attempts: 1 },
        });
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
      for (const rsvp of rsvps) {
        const email = rsvp.email || "";
        if (schedule.channel === "email" && !email) continue;
        const channelAllowed = await canUseChannel(String(rsvp._id), schedule.channel);
        if (!channelAllowed) continue;

        if (schedule.channel === "email") {
          const html = template?.html
            ? applyTemplateTokens(template.html, event, rsvp)
            : await buildScheduleEmailHtml(event, rsvp, schedule, baseUrl);
          const subject =
            template?.subject ||
            `${schedule.messageName || schedule.messageType} - ${event.name}`;
          await sendEmail(
            email,
            subject,
            html,
            `SoftInvites <info@softinvite.com>`,
            undefined,
            {
              eventId: String(event._id),
              rsvpId: String(rsvp._id),
              messageType: schedule.messageType,
              replyTo,
            },
          );
          sentCount += 1;
        } else if (schedule.channel === "whatsapp") {
          await whatsappService.sendTemplateMessage(
            rsvp.phone || "",
            "event_invitation",
            [rsvp.guestName, event.name],
            String(rsvp._id),
            String(event._id),
          );
          sentCount += 1;
        } else if (schedule.channel === "bulkSms") {
          await smsService.sendSms({
            to: rsvp.phone || "",
            message: `${event.name}: ${event.rsvpMessage || "You're invited!"}`,
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
    } catch (error: any) {
      await MessageSchedule.findByIdAndUpdate(schedule._id, {
        status: schedule.attempts >= 2 ? "failed" : "pending",
        lastAttemptAt: new Date(),
        $inc: { attempts: 1 },
        errorMessage: error?.message || "Failed to process schedule",
      });
    }
  }
};

export const startMessageScheduler = () => {
  if (process.env.RUN_SCHEDULER === "false") {
    return;
  }
  cron.schedule("*/5 * * * *", async () => {
    try {
      await processPendingSchedules();
    } catch (error) {
      console.error("Scheduler run failed:", error);
    }
  });
};

startMessageScheduler();
