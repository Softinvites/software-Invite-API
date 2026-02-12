import { Request, Response } from "express";
import { Types } from "mongoose";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { RSVPFormLink } from "../models/rsvpFormLinkModel";
import { sendEmail } from "../library/helpers/emailService";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference";

type AttendanceStatus = "yes" | "no" | "pending";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "softinvites@gmail.com";

export const getRsvpFormByToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const formLink = await RSVPFormLink.findOne({ token });
    if (!formLink) {
      return res.status(404).json({ message: "RSVP form link not found" });
    }

    const event = await Event.findById(formLink.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    if ((event as any).servicePackage === "invitation-only") {
      return res.status(400).json({ message: "RSVP is disabled for this event" });
    }

    return res.json({
      token,
      submitted: formLink.submitted,
      event: {
        id: event._id,
        name: event.name,
        date: event.date,
        location: (event as any).location,
        iv: (event as any).iv,
        description: (event as any).description,
        rsvpBgColor: (event as any).rsvpBgColor,
        rsvpAccentColor: (event as any).rsvpAccentColor,
        qrCodeBgColor: (event as any).qrCodeBgColor,
        qrCodeCenterColor: (event as any).qrCodeCenterColor,
        qrCodeEdgeColor: (event as any).qrCodeEdgeColor,
        rsvpFormSettings: (event as any).rsvpFormSettings,
        servicePackage: (event as any).servicePackage,
        channelConfig: (event as any).channelConfig,
      },
      form: {
        isEditable: false,
      },
    });
  } catch (error: any) {
    console.error("getRsvpFormByToken error", error);
    res.status(500).json({ message: "Failed to load RSVP form" });
  }
};

export const submitRsvpForm = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const formLink = await RSVPFormLink.findOne({ token });
    if (!formLink) {
      return res.status(404).json({ message: "RSVP form link not found" });
    }
    if (formLink.submitted) {
      return res.status(400).json({ message: "Form already submitted" });
    }

    const { guestName, email, phone, attendanceStatus, comments } = req.body;
    const cleanedGuestName = String(guestName || "").trim();
    const cleanedEmail = typeof email === "string" ? email.trim() : "";
    const cleanedPhone = typeof phone === "string" ? phone.trim() : "";
    const normalizedStatus = String(attendanceStatus || "")
      .trim()
      .toLowerCase();
    const cleanedComments =
      typeof comments === "string"
        ? comments
        : comments === null || comments === undefined
          ? ""
          : String(comments);

    if (!cleanedGuestName || !normalizedStatus) {
      return res
        .status(400)
        .json({ message: "Guest name and attendance status are required" });
    }
    if (!["yes", "no"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "Invalid attendance status" });
    }

    const event = await Event.findById(formLink.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    const servicePackage =
      (event as any).servicePackage || "standard-rsvp";
    const trackingEnabled =
      (event as any)?.channelConfig?.email?.trackingEnabled !== false;
    const replyTo = (event as any)?.channelConfig?.email?.replyTo;
    if (servicePackage === "invitation-only") {
      return res
        .status(400)
        .json({ message: "RSVP is disabled for this event" });
    }

    const rsvp = await RSVP.create({
      eventId: event._id,
      token: formLink.token,
      guestName: cleanedGuestName,
      email: cleanedEmail || null,
      phone: cleanedPhone || null,
      attendanceStatus: normalizedStatus as AttendanceStatus,
      comments: cleanedComments,
      submissionDate: new Date(),
      source: "form_submission",
      isEditable: false,
      qrCodeBgColor: (event as any).qrCodeBgColor,
      qrCodeCenterColor: (event as any).qrCodeCenterColor,
      qrCodeEdgeColor: (event as any).qrCodeEdgeColor,
    });

    formLink.submitted = true;
    formLink.submittedAt = new Date();
    await formLink.save();

    // Save optional channel preferences if provided
    if (req.body?.preferredChannels || req.body?.whatsappOptIn || req.body?.smsOptIn) {
      const preferredChannels = Array.isArray(req.body.preferredChannels)
        ? req.body.preferredChannels
        : typeof req.body.preferredChannels === "string"
          ? req.body.preferredChannels.split(",").map((s: string) => s.trim()).filter(Boolean)
          : ["email"];
      await RSVPChannelPreference.findOneAndUpdate(
        { rsvpId: rsvp._id },
        {
          rsvpId: rsvp._id,
          preferredChannels,
          whatsappOptIn: !!req.body.whatsappOptIn,
          smsOptIn: !!req.body.smsOptIn,
          whatsappNumber: req.body.whatsappNumber || null,
          mobileNumber: req.body.mobileNumber || null,
          optInDate: new Date(),
        },
        { upsert: true, new: true },
      );
    }

    const emailJobs: Array<{
      label: string;
      promise: Promise<unknown>;
    }> = [];

    const sendGuestAck =
      servicePackage !== "one-time-rsvp" &&
      servicePackage !== "standard-rsvp" &&
      servicePackage !== "full-rsvp";

    if (cleanedEmail && sendGuestAck) {
      emailJobs.push({
        label: "guest",
        promise: sendEmail(
          cleanedEmail,
          `RSVP received for ${event.name}`,
          `<p>Thanks ${cleanedGuestName}, we have received your response for ${event.name}.</p>`,
          `SoftInvites <info@softinvite.com>`,
          undefined,
          {
            eventId: String(event._id),
            rsvpId: String(rsvp._id),
            messageType: "rsvp-ack",
            trackingEnabled,
            replyTo,
          },
        ),
      });
    }

    if (ADMIN_EMAIL) {
      emailJobs.push({
        label: "admin",
        promise: sendEmail(
          ADMIN_EMAIL,
          `New RSVP submission - ${event.name}`,
          `<p>${cleanedGuestName} responded: ${normalizedStatus}</p>`,
          undefined,
          undefined,
          {
            eventId: String(event._id),
            rsvpId: String(rsvp._id),
            messageType: "rsvp-admin-alert",
            trackingEnabled,
            replyTo,
          },
        ),
      });
    }

    if (emailJobs.length) {
      const results = await Promise.allSettled(
        emailJobs.map((job) => job.promise),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `submitRsvpForm email failed (${emailJobs[index].label})`,
            result.reason,
          );
        }
      });
    }

    return res.json({
      message: "RSVP submitted",
      rsvp: {
        id: rsvp._id,
        attendanceStatus: rsvp.attendanceStatus,
        submissionDate: rsvp.submissionDate,
      },
    });
  } catch (error: any) {
    console.error("submitRsvpForm error", error);
    res.status(500).json({ message: "Failed to submit RSVP form" });
  }
};

export const respondFromEmail = async (req: Request, res: Response) => {
  try {
    const { rsvpId } = req.params;
    const { status } = req.query as { status?: AttendanceStatus };
    if (!status || !["yes", "no"].includes(status)) {
      return res.status(400).send("Invalid status");
    }
    const update = { attendanceStatus: status, submissionDate: new Date() };
    let rsvp = null;

    if (Types.ObjectId.isValid(rsvpId)) {
      rsvp = await RSVP.findByIdAndUpdate(rsvpId, update, { new: true });
    }
    if (!rsvp) {
      rsvp = await RSVP.findOneAndUpdate({ token: rsvpId }, update, { new: true });
    }
    if (!rsvp && Types.ObjectId.isValid(rsvpId)) {
      rsvp = await RSVP.findOneAndUpdate({ guestId: rsvpId }, update, { new: true });
    }
    if (!rsvp) {
      return res.status(404).send("RSVP not found");
    }
    const isYes = status === "yes";
    const accent = isYes ? "#2e7d32" : "#c62828";
    const bg = isYes ? "#e8f5e9" : "#ffebee";
    const title = isYes ? "You're confirmed!" : "We'll miss you!";
    const message = isYes
      ? "Thanks for confirming your attendance."
      : "Thanks for letting us know you can't make it.";

    return res.send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>RSVP Updated</title>
          <style>
            :root {
              color-scheme: light;
              --mui-bg: ${bg};
              --mui-accent: ${accent};
              --mui-text: #1f2937;
              --mui-muted: #6b7280;
              --mui-card: #ffffff;
              --mui-shadow: 0 10px 30px rgba(0,0,0,0.12);
            }
            body {
              margin: 0;
              background: var(--mui-bg);
              font-family: "Roboto", "Helvetica", "Arial", sans-serif;
              color: var(--mui-text);
            }
            .shell {
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
            }
            .card {
              width: 100%;
              max-width: 520px;
              background: var(--mui-card);
              border-radius: 18px;
              box-shadow: var(--mui-shadow);
              padding: 28px;
              text-align: center;
            }
            .badge {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              padding: 6px 12px;
              border-radius: 999px;
              font-size: 12px;
              font-weight: 600;
              color: var(--mui-accent);
              background: rgba(0,0,0,0.06);
              margin-bottom: 12px;
            }
            h1 {
              margin: 0 0 8px 0;
              font-size: 26px;
            }
            p {
              margin: 6px 0;
              color: var(--mui-muted);
              font-size: 15px;
            }
            .status {
              margin: 18px 0 20px 0;
              font-weight: 700;
              color: var(--mui-accent);
              font-size: 18px;
            }
          </style>
        </head>
        <body>
          <div class="shell">
            <div class="card">
              <div class="badge">RSVP Update</div>
              <h1>${title}</h1>
              <p>${message}</p>
              <div class="status">Status: ${status.toUpperCase()}</div>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("respondFromEmail error", error);
    res.status(500).send("Failed to update RSVP");
  }
};

const resolveRsvpByTokenOrId = async (idOrToken: string) => {
  if (Types.ObjectId.isValid(idOrToken)) {
    const byId = await RSVP.findById(idOrToken);
    if (byId) return byId;
  }
  const byToken = await RSVP.findOne({ token: idOrToken });
  if (byToken) return byToken;
  if (Types.ObjectId.isValid(idOrToken)) {
    const byGuest = await RSVP.findOne({ guestId: idOrToken });
    if (byGuest) return byGuest;
  }
  return null;
};

export const getRsvpPreferences = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const rsvp = await resolveRsvpByTokenOrId(token);
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }
    const prefs = await RSVPChannelPreference.findOne({ rsvpId: rsvp._id });
    return res.json({
      rsvpId: rsvp._id,
      guestName: rsvp.guestName,
      preferences: prefs || {
        preferredChannels: ["email"],
        whatsappOptIn: false,
        smsOptIn: false,
        whatsappNumber: null,
        mobileNumber: null,
      },
    });
  } catch (error: any) {
    console.error("getRsvpPreferences error", error);
    return res.status(500).json({ message: "Failed to load preferences" });
  }
};

export const updateRsvpPreferences = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const rsvp = await resolveRsvpByTokenOrId(token);
    if (!rsvp) {
      return res.status(404).json({ message: "RSVP not found" });
    }

    const preferredChannels = Array.isArray(req.body.preferredChannels)
      ? req.body.preferredChannels
      : typeof req.body.preferredChannels === "string"
        ? req.body.preferredChannels.split(",").map((s: string) => s.trim()).filter(Boolean)
        : ["email"];

    const prefs = await RSVPChannelPreference.findOneAndUpdate(
      { rsvpId: rsvp._id },
      {
        rsvpId: rsvp._id,
        preferredChannels,
        whatsappOptIn: !!req.body.whatsappOptIn,
        smsOptIn: !!req.body.smsOptIn,
        whatsappNumber: req.body.whatsappNumber || null,
        mobileNumber: req.body.mobileNumber || null,
        optInDate: new Date(),
      },
      { upsert: true, new: true },
    );

    return res.json({ message: "Preferences updated", preferences: prefs });
  } catch (error: any) {
    console.error("updateRsvpPreferences error", error);
    return res.status(500).json({ message: "Failed to update preferences" });
  }
};
