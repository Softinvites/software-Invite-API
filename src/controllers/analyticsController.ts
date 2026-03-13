import { Request, Response } from "express";
import { RSVP } from "../models/rsvpmodel";
import { EmailMessage } from "../models/emailMessage";
import { WhatsAppMessage } from "../models/WhatsAppMessage";
import { SmsMessage } from "../models/smsMessage";

const buildDateFilter = (start?: string, end?: string) => {
  if (!start && !end) return null;
  const filter: Record<string, Date> = {};
  if (start) {
    const parsed = new Date(start);
    if (!Number.isNaN(parsed.getTime())) {
      filter.$gte = parsed;
    }
  }
  if (end) {
    const parsed = new Date(end);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(23, 59, 59, 999);
      filter.$lte = parsed;
    }
  }
  return Object.keys(filter).length ? filter : null;
};

const matchesDateFilter = (
  value: Date | string | null | undefined,
  filter: Record<string, Date> | null,
) => {
  if (!filter) return true;
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  if (filter.$gte && parsed < filter.$gte) return false;
  if (filter.$lte && parsed > filter.$lte) return false;
  return true;
};

const isRsvpResponded = (rsvp: any) =>
  Boolean(rsvp?.submissionDate) ||
  rsvp?.attendanceStatus === "yes" ||
  rsvp?.attendanceStatus === "no";

export const getAnalyticsOverview = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dateFilter = buildDateFilter(
      req.query.start as string,
      req.query.end as string,
    );
    const rsvps = await RSVP.find({ eventId });
    const filteredRsvps = rsvps.filter((r) =>
      matchesDateFilter(r.submissionDate || r.createdAt, dateFilter),
    );
    const totalInvited = filteredRsvps.length;
    const totalResponses = filteredRsvps.filter((r) => isRsvpResponded(r)).length;
    const yes = filteredRsvps.filter((r) => r.attendanceStatus === "yes").length;
    const no = filteredRsvps.filter((r) => r.attendanceStatus === "no").length;
    const pending = filteredRsvps.filter(
      (r) => r.attendanceStatus === "pending",
    ).length;

    const emailQuery: any = { eventId };
    if (dateFilter) emailQuery.createdAt = dateFilter;
    const emailMessages = await EmailMessage.find(emailQuery);
    const opens = emailMessages.reduce((acc, m) => acc + (m.openCount || 0), 0);
    const clicks = emailMessages.reduce((acc, m) => acc + (m.clickCount || 0), 0);

    return res.json({
      totalInvited,
      totalResponses,
      yes,
      no,
      pending,
      responseRate: totalInvited ? (totalResponses / totalInvited) * 100 : 0,
      emailOpens: opens,
      emailClicks: clicks,
    });
  } catch (error: any) {
    console.error("getAnalyticsOverview error", error);
    return res.status(500).json({ message: "Failed to load analytics" });
  }
};

export const getChannelAnalytics = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dateFilter = buildDateFilter(
      req.query.start as string,
      req.query.end as string,
    );
    const emailQuery: any = { eventId };
    const whatsappQuery: any = { eventId };
    const smsQuery: any = { eventId };
    if (dateFilter) {
      emailQuery.createdAt = dateFilter;
      whatsappQuery.createdAt = dateFilter;
      smsQuery.createdAt = dateFilter;
    }

    const emailMessages = await EmailMessage.find(emailQuery).lean();
    const whatsappMessages = (await WhatsAppMessage.find(whatsappQuery).lean()) as Array<{
      status?: string;
    }>;
    const smsMessages = await SmsMessage.find(smsQuery).lean();

    let whatsappDelivered = 0;
    let whatsappFailed = 0;
    for (const message of whatsappMessages) {
      const status = message.status;
      if (status === "delivered" || status === "read") whatsappDelivered += 1;
      else if (status === "failed") whatsappFailed += 1;
    }

    return res.json({
      email: {
        sent: emailMessages.length,
        opens: emailMessages.reduce((acc, m) => acc + (m.openCount || 0), 0),
        clicks: emailMessages.reduce((acc, m) => acc + (m.clickCount || 0), 0),
      },
      whatsapp: {
        sent: whatsappMessages.length,
        delivered: whatsappDelivered,
        failed: whatsappFailed,
      },
      sms: {
        sent: smsMessages.length,
        delivered: smsMessages.filter((m) => m.status === "delivered").length,
        failed: smsMessages.filter((m) => m.status === "failed").length,
      },
    });
  } catch (error: any) {
    console.error("getChannelAnalytics error", error);
    return res.status(500).json({ message: "Failed to load channel analytics" });
  }
};

export const getTimelineAnalytics = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dateFilter = buildDateFilter(
      req.query.start as string,
      req.query.end as string,
    );
    const rsvps = await RSVP.find({ eventId });
    const bucket: Record<string, number> = {};
    rsvps
      .filter((r) => isRsvpResponded(r))
      .forEach((r) => {
        const date = r.submissionDate || r.updatedAt || r.createdAt || new Date();
        if (!matchesDateFilter(date, dateFilter)) {
          return;
        }
        const key = new Date(date).toISOString().slice(0, 10);
        bucket[key] = (bucket[key] || 0) + 1;
      });
    const timeline = Object.keys(bucket)
      .sort()
      .map((date) => ({ date, count: bucket[date] }));
    return res.json({ timeline });
  } catch (error: any) {
    console.error("getTimelineAnalytics error", error);
    return res.status(500).json({ message: "Failed to load timeline analytics" });
  }
};

export const getAnalyticsExport = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dateFilter = buildDateFilter(
      req.query.start as string,
      req.query.end as string,
    );
    const overview = (await RSVP.find({ eventId })).filter((r) =>
      matchesDateFilter(r.submissionDate || r.createdAt, dateFilter),
    );
    return res.json({ export: overview });
  } catch (error: any) {
    console.error("getAnalyticsExport error", error);
    return res.status(500).json({ message: "Failed to export analytics" });
  }
};

export const getEmailAnalytics = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dateFilter = buildDateFilter(
      req.query.start as string,
      req.query.end as string,
    );
    const emailQuery: any = { eventId };
    if (dateFilter) emailQuery.createdAt = dateFilter;
    const emailMessages = await EmailMessage.find(emailQuery);
    const sent = emailMessages.length;
    const opens = emailMessages.reduce((acc, m) => acc + (m.openCount || 0), 0);
    const clicks = emailMessages.reduce((acc, m) => acc + (m.clickCount || 0), 0);
    return res.json({
      sent,
      opens,
      clicks,
      openRate: sent ? (opens / sent) * 100 : 0,
      clickRate: sent ? (clicks / sent) * 100 : 0,
    });
  } catch (error: any) {
    console.error("getEmailAnalytics error", error);
    return res.status(500).json({ message: "Failed to load email analytics" });
  }
};

export const getWhatsAppAnalytics = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dateFilter = buildDateFilter(
      req.query.start as string,
      req.query.end as string,
    );
    const whatsappQuery: any = { eventId };
    if (dateFilter) whatsappQuery.createdAt = dateFilter;
    const messages = (await WhatsAppMessage.find(whatsappQuery).lean()) as Array<{
      status?: string;
    }>;
    let delivered = 0;
    let read = 0;
    let failed = 0;
    for (const message of messages) {
      if (message.status === "delivered") {
        delivered += 1;
      } else if (message.status === "read") {
        delivered += 1;
        read += 1;
      } else if (message.status === "failed") {
        failed += 1;
      }
    }
    return res.json({
      sent: messages.length,
      delivered,
      read,
      failed,
    });
  } catch (error: any) {
    console.error("getWhatsAppAnalytics error", error);
    return res.status(500).json({ message: "Failed to load WhatsApp analytics" });
  }
};

export const getSmsAnalytics = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dateFilter = buildDateFilter(
      req.query.start as string,
      req.query.end as string,
    );
    const smsQuery: any = { eventId };
    if (dateFilter) smsQuery.createdAt = dateFilter;
    const messages = await SmsMessage.find(smsQuery);
    return res.json({
      sent: messages.length,
      delivered: messages.filter((m) => m.status === "delivered").length,
      failed: messages.filter((m) => m.status === "failed").length,
    });
  } catch (error: any) {
    console.error("getSmsAnalytics error", error);
    return res.status(500).json({ message: "Failed to load SMS analytics" });
  }
};
