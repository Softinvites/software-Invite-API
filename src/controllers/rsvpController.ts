import { Request, Response } from "express";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { RSVPFormLink } from "../models/rsvpFormLinkModel";
import { sendEmail } from "../library/helpers/emailService";

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
        qrCodeBgColor: (event as any).qrCodeBgColor,
        qrCodeCenterColor: (event as any).qrCodeCenterColor,
        qrCodeEdgeColor: (event as any).qrCodeEdgeColor,
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
    if (!guestName || !attendanceStatus) {
      return res
        .status(400)
        .json({ message: "Guest name and attendance status are required" });
    }
    if (!["yes", "no"].includes(attendanceStatus)) {
      return res.status(400).json({ message: "Invalid attendance status" });
    }

    const event = await Event.findById(formLink.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const rsvp = await RSVP.create({
      eventId: event._id,
      guestName: String(guestName).trim(),
      email: email || null,
      phone: phone || null,
      attendanceStatus: attendanceStatus as AttendanceStatus,
      comments: comments || "",
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

    if (email) {
      await sendEmail(
        email,
        `RSVP received for ${event.name}`,
        `<p>Thanks ${guestName}, your RSVP for ${event.name} has been received.</p>`,
        `SoftInvites <info@softinvite.com>`,
      );
    }
    if (ADMIN_EMAIL) {
      await sendEmail(
        ADMIN_EMAIL,
        `New RSVP submission - ${event.name}`,
        `<p>${guestName} responded: ${attendanceStatus}</p>`,
      );
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
    const rsvp = await RSVP.findByIdAndUpdate(
      rsvpId,
      { attendanceStatus: status, submissionDate: new Date() },
      { new: true },
    );
    if (!rsvp) {
      return res.status(404).send("RSVP not found");
    }
    return res.send(
      `<div style="font-family:Arial,sans-serif;padding:24px;"><h2>Thank you!</h2><p>Your RSVP has been updated to "${status}".</p></div>`,
    );
  } catch (error: any) {
    console.error("respondFromEmail error", error);
    res.status(500).send("Failed to update RSVP");
  }
};
