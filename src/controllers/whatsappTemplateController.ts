import { Request, Response } from "express";
import { WhatsAppTemplate } from "../models/WhatsAppTemplate";
import { Event } from "../models/eventmodel";
import { RSVP } from "../models/rsvpmodel";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference";
import whatsappService from "../utils/whatsappService";

export const createWhatsAppTemplate = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { name, displayName, language, category, components } = req.body || {};
    if (!name || !displayName) {
      return res.status(400).json({ message: "name and displayName are required" });
    }
    const template = await WhatsAppTemplate.create({
      eventId,
      name,
      displayName,
      language,
      category,
      components,
    });
    return res.status(201).json({ template });
  } catch (error: any) {
    console.error("createWhatsAppTemplate error", error);
    return res.status(500).json({ message: "Failed to create WhatsApp template" });
  }
};

export const listWhatsAppTemplates = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const templates = await WhatsAppTemplate.find({ eventId }).sort({ createdAt: -1 });
    return res.json({ templates });
  } catch (error: any) {
    console.error("listWhatsAppTemplates error", error);
    return res.status(500).json({ message: "Failed to load WhatsApp templates" });
  }
};

export const sendWhatsAppBroadcast = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { templateName = "event_invitation", rsvpIds } = req.body || {};

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const filter: any = { eventId };
    if (Array.isArray(rsvpIds) && rsvpIds.length) {
      filter._id = { $in: rsvpIds };
    }

    const rsvps = await RSVP.find(filter);
    let sent = 0;
    let skipped = 0;

    for (const rsvp of rsvps) {
      if (!rsvp.phone) {
        skipped += 1;
        continue;
      }
      const pref = await RSVPChannelPreference.findOne({ rsvpId: rsvp._id });
      if ((event as any)?.channelConfig?.whatsapp?.optInRequired && !pref?.whatsappOptIn) {
        skipped += 1;
        continue;
      }

      const eventIdValue = String((event as any)._id || eventId);
      await whatsappService.sendTemplateMessage(
        rsvp.phone,
        templateName,
        [rsvp.guestName, event.name, event.location || "", event.date || ""],
        rsvp._id.toString(),
        eventIdValue,
      );
      sent += 1;
    }

    return res.json({ message: "WhatsApp broadcast sent", sent, skipped, total: rsvps.length });
  } catch (error: any) {
    console.error("sendWhatsAppBroadcast error", error);
    return res.status(500).json({ message: "Failed to send WhatsApp broadcast" });
  }
};

export const optInWhatsApp = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { rsvpId, token, phone } = req.body || {};
    const rsvp = rsvpId
      ? await RSVP.findById(rsvpId)
      : token
        ? await RSVP.findOne({ token })
        : null;
    if (!rsvp || String(rsvp.eventId) !== String(eventId)) {
      return res.status(404).json({ message: "RSVP not found" });
    }

    const pref = await RSVPChannelPreference.findOneAndUpdate(
      { rsvpId: rsvp._id },
      {
        rsvpId: rsvp._id,
        whatsappOptIn: true,
        whatsappNumber: phone || rsvp.phone || null,
        optInDate: new Date(),
      },
      { upsert: true, new: true },
    );

    return res.json({ message: "WhatsApp opt-in saved", preferences: pref });
  } catch (error: any) {
    console.error("optInWhatsApp error", error);
    return res.status(500).json({ message: "Failed to save WhatsApp opt-in" });
  }
};
