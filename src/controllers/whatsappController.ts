import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Guest } from '../models/guestmodel.js';
import { RSVP } from '../models/rsvpmodel.js';
import { Event } from '../models/eventmodel.js';
import { WhatsAppMessage } from '../models/WhatsAppMessage.js';
import { WhatsAppInboundMessage } from '../models/WhatsAppInboundMessage.js';
import whatsappService from '../utils/whatsappService.js';
import {
  buildWhatsAppTemplateParams,
  getDefaultWhatsAppTemplateName,
} from '../utils/whatsappTemplateParams.js';
import { loadDbTemplateByName } from '../utils/loadDbTemplate.js';
import { backfillInboundEventIds } from '../services/whatsappInboundService.js';
import { RSVPFormLink } from '../models/rsvpFormLinkModel.js';
import { generateRsvpToken } from '../utils/rsvpToken.js';

const normalizeTemplateVariables = (value: any): Record<string, string> | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const normalized: Record<string, string> = {};

  for (const [key, entry] of Object.entries(raw)) {
    const index = Number.parseInt(key, 10);
    if (!Number.isInteger(index) || index <= 0) continue;

    const trimmed =
      typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim();
    if (!trimmed) continue;

    normalized[String(index)] = trimmed;
  }

  return Object.keys(normalized).length ? normalized : null;
};

export const sendBulkWhatsApp = async (req: Request, res: Response) => {
  try {
    const {
      eventId,
      templateName = getDefaultWhatsAppTemplateName(),
      guestIds,
      templateVariables,
    } = req.body;

    if (!eventId) {
      return res.status(400).json({ message: 'Event ID is required' });
    }

    const eventDoc = await Event.findById(eventId);
    if (!eventDoc) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Guard: wedding_invite requires event.iv (S3 invitation image URL)
    if (/^wedding_invite/i.test(templateName) && !String(eventDoc.iv || '').trim()) {
      return res.status(400).json({
        message:
          'The wedding_invite template requires an invitation image. ' +
          'Go to Edit Event and upload an invitation image (PNG) first.',
        code: 'MISSING_EVENT_IV',
      });
    }

    let guestQuery: any = { eventId, phone: { $exists: true, $ne: "" } };
    if (guestIds && guestIds.length > 0) {
      guestQuery._id = { $in: guestIds };
    }

    const guests = await Guest.find(guestQuery);
    if (!guests.length) {
      return res.status(404).json({ message: 'No guests with phone numbers found' });
    }

    console.log(`📱 Sending WhatsApp to ${guests.length} guests`);

    const guestsData = guests.map(g => ({
      _id: g._id.toString(),
      fullname: g.fullname,
      phone: g.phone,
      qrCode: g.qrCode,
      pngUrl: g.pngUrl,
    }));

    const eventData = {
      _id: (eventDoc._id as any).toString(),
      name: eventDoc.name,
      location: eventDoc.location,
      date: eventDoc.date,
      iv: eventDoc.iv,
    };

    let formLinkPath: string | null = null;
    if (/^rsvp_form/i.test(templateName)) {
      const fToken = generateRsvpToken(12);
      const redirectUrl = typeof req.body?.redirectUrl === 'string' ? req.body.redirectUrl.trim() || null : null;
      const link = await RSVPFormLink.create({
        eventId: eventDoc._id,
        token: fToken,
        slug: null,
        redirectUrl,
      });
      formLinkPath = link.token;
    }

    const result = await whatsappService.sendBulkMessages(guestsData, eventData, templateName, {
      templateVariables: normalizeTemplateVariables(templateVariables),
      formLinkPath,
    });

    res.json({
      message: 'WhatsApp bulk send completed',
      ...result
    });

  } catch (error: any) {
    console.error('Bulk WhatsApp error:', error);
    res.status(500).json({ 
      message: 'Failed to send WhatsApp messages', 
      error: error.message 
    });
  }
};

export const sendSingleWhatsApp = async (req: Request, res: Response) => {
  try {
    const { guestId, templateName = getDefaultWhatsAppTemplateName(), templateVariables } =
      req.body;

    if (!guestId) {
      return res.status(400).json({ message: 'Guest ID is required' });
    }

    const guest = await Guest.findById(guestId);
    if (!guest) {
      return res.status(404).json({ message: 'Guest not found' });
    }

    if (!guest.phone) {
      return res.status(400).json({ message: 'Guest has no phone number' });
    }

    const eventDoc = await Event.findById(guest.eventId);
    if (!eventDoc) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const normalizedTemplate = String(templateName || '').toLowerCase().trim();
    const bucket = String(process.env.S3_BUCKET || '').trim();
    const region = String(process.env.AWS_REGION || '').trim();
    const eventIdValue = String(eventDoc._id || '').trim();
    const buildQrEmailPngUrl = () => {
      if (!bucket || !region || !eventIdValue) return '';
      return `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/email_png/${eventIdValue}/${guest._id}.png`;
    };

    let passUrl: string;
    if (normalizedTemplate === 'rsvp_form') {
      const fToken = generateRsvpToken(12);
      const redirectUrl = typeof req.body?.redirectUrl === 'string' ? req.body.redirectUrl.trim() || null : null;
      const link = await RSVPFormLink.create({
        eventId: eventDoc._id,
        token: fToken,
        slug: null,
        redirectUrl,
      });
      passUrl = link.token;
    } else if (normalizedTemplate === 'rsvp_followup' || normalizedTemplate === 'wedding_invite') {
      passUrl =
        buildQrEmailPngUrl() ||
        guest.pngUrl ||
        (guest.qrCode?.includes('.png')
          ? guest.qrCode
          : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`);
    } else {
      passUrl =
        guest.pngUrl ||
        (guest.qrCode?.includes('.png')
          ? guest.qrCode
          : `https://292x833w13.execute-api.us-east-2.amazonaws.com/guest/download-emailcode/${guest._id}`);
    }

    const dbTemplateInfo = await loadDbTemplateByName(templateName);
    const templateParams = buildWhatsAppTemplateParams({
      templateName,
      recipientName: guest.fullname,
      eventName: eventDoc.name,
      location: eventDoc.location || 'TBA',
      eventDate: eventDoc.date || 'TBA',
      passUrl,
      eventIv: eventDoc.iv || null,
      templateVariables: normalizeTemplateVariables(templateVariables) || undefined,
      customDefinition: dbTemplateInfo?.variableDefinitions || null,
    });

    // Guard: wedding_invite requires event.iv
    if (/^wedding_invite/i.test(normalizedTemplate) && !String(eventDoc.iv || '').trim()) {
      return res.status(400).json({
        message:
          'The wedding_invite template requires an invitation image. ' +
          'Go to Edit Event and upload an invitation image (PNG) first.',
        code: 'MISSING_EVENT_IV',
      });
    }

    const result = await whatsappService.sendTemplateMessage(
      guest.phone,
      templateName,
      templateParams,
      guest._id.toString(),
      (eventDoc._id as any).toString(),
      {} // wedding_invite image is body variable {{8}}, never a header
    );

    if (result.success) {
      res.json({
        message: 'WhatsApp message sent successfully',
        messageId: result.messageId
      });
    } else {
      res.status(500).json({
        message: 'Failed to send WhatsApp message',
        error: result.error
      });
    }

  } catch (error: any) {
    console.error('Single WhatsApp error:', error);
    res.status(500).json({ 
      message: 'Failed to send WhatsApp message', 
      error: error.message 
    });
  }
};

export const getWhatsAppStatus = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      return res.status(400).json({ message: 'Event ID is required' });
    }

    const stats = await whatsappService.getMessageStats(eventId);

    const messages = (await WhatsAppMessage.find({ eventId })
      .sort({ sentAt: -1 })
      .lean()
      .exec()) as any[];

    // Resolve guest names from BOTH collections in two batched queries:
    //   - Guest collection (sends from the Guest page)
    //   - RSVP collection  (sends from the RSVP admin / scheduler)
    //
    // Backward-compat: legacy scheduler sends stored the RSVP id inside the
    // `guestId` field by mistake. We treat any non-null id from either field
    // as a candidate against either collection, so the lookup works for both
    // old and new records.
    const candidateIds = Array.from(
      new Set(
        messages
          .flatMap((m) => [m.guestId, m.rsvpId])
          .filter(Boolean)
          .map((id) => String(id)),
      ),
    );

    const [guestDocs, rsvpDocs] = await Promise.all([
      candidateIds.length
        ? Guest.find({ _id: { $in: candidateIds } })
            .select('fullname phone')
            .lean()
        : Promise.resolve([] as any[]),
      candidateIds.length
        ? RSVP.find({ _id: { $in: candidateIds } })
            .select('guestName phone')
            .lean()
        : Promise.resolve([] as any[]),
    ]);

    const nameById = new Map<string, string>();
    (guestDocs as any[]).forEach((g) => {
      if (g?._id && g?.fullname) nameById.set(String(g._id), g.fullname);
    });
    // RSVP wins on overlap — but ids are globally unique, so overlap is unlikely.
    (rsvpDocs as any[]).forEach((r) => {
      if (r?._id && r?.guestName) nameById.set(String(r._id), r.guestName);
    });

    const resolveName = (msg: any) =>
      nameById.get(String(msg.rsvpId || '')) ||
      nameById.get(String(msg.guestId || '')) ||
      'Unknown';

    res.json({
      stats,
      messages: messages.map((msg: any) => ({
        id: msg._id,
        guestName: resolveName(msg),
        phoneNumber: msg.phoneNumber,
        status: msg.status,
        templateName: msg.templateName,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
        errorMessage: msg.errorMessage,
      })),
    });

  } catch (error: any) {
    console.error('WhatsApp status error:', error);
    res.status(500).json({ 
      message: 'Failed to get WhatsApp status', 
      error: error.message 
    });
  }
};

export const getWhatsAppReplies = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    if (!eventId) {
      return res.status(400).json({ message: 'Event ID is required' });
    }

    // Back-fill any messages that were saved with eventId=null due to phone mismatch
    try { await backfillInboundEventIds(eventId); } catch { /* non-fatal */ }

    let oid: mongoose.Types.ObjectId | null = null;
    try { oid = new mongoose.Types.ObjectId(eventId); } catch { /* invalid id */ }

    // Query by both ObjectId and string forms to handle any storage inconsistency
    const eventIdFilter = oid
      ? { $in: [oid, eventId] }
      : eventId;

    const replies = await WhatsAppInboundMessage.find({ eventId: eventIdFilter })
      .populate('guestId', 'fullname phone')
      .populate('rsvpId', 'guestName phone')
      .sort({ receivedAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      total: replies.length,
      replies: replies.map((item: any) => ({
        id: item._id,
        provider: item.provider,
        from: item.from,
        to: item.to,
        body: item.body,
        profileName: item.profileName,
        waId: item.waId,
        providerMessageId: item.providerMessageId,
        guestName: item.guestId?.fullname || item.rsvpId?.guestName || null,
        guestPhone: item.guestId?.phone || item.rsvpId?.phone || null,
        status: item.status,
        receivedAt: item.receivedAt,
      })),
    });
  } catch (error: any) {
    console.error('WhatsApp replies fetch error:', error);
    return res.status(500).json({
      message: 'Failed to fetch WhatsApp replies',
      error: error.message,
    });
  }
};

export const sendWhatsAppReply = async (req: Request, res: Response) => {
  try {
    const { guestId, eventId, phoneNumber, message } = req.body || {};
    if (!eventId) {
      return res.status(400).json({ message: 'eventId is required' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: 'message is required' });
    }

    let resolvedGuestId: string | null = null;
    let resolvedPhoneNumber =
      typeof phoneNumber === 'string' ? phoneNumber.trim() : '';

    if (guestId) {
      const guest = await Guest.findById(guestId);
      if (!guest) {
        return res.status(404).json({ message: 'Guest not found' });
      }
      if (String(guest.eventId) !== String(eventId)) {
        return res.status(400).json({ message: 'Guest does not belong to the event' });
      }
      resolvedGuestId = guest._id.toString();
      if (!resolvedPhoneNumber) {
        resolvedPhoneNumber = String(guest.phone || '').trim();
      }
    }

    if (!resolvedPhoneNumber) {
      return res.status(400).json({
        message: 'Provide guestId with a valid phone or pass phoneNumber directly',
      });
    }

    const result = await whatsappService.sendTextMessage(
      resolvedPhoneNumber,
      String(message).trim(),
      resolvedGuestId,
      String(eventId),
    );

    if (!result.success) {
      return res.status(500).json({
        message: 'Failed to send WhatsApp reply',
        error: result.error,
      });
    }

    return res.json({
      message: 'WhatsApp reply sent',
      messageId: result.messageId,
    });
  } catch (error: any) {
    console.error('WhatsApp reply send error:', error);
    return res.status(500).json({
      message: 'Failed to send WhatsApp reply',
      error: error.message,
    });
  }
};

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  try {
    const { entry } = req.body;

    if (!entry || !entry[0]?.changes) {
      return res.status(200).send('OK');
    }

    for (const change of entry[0].changes) {
      if (change.field === 'messages') {
        const { statuses } = change.value;
        
        if (statuses) {
          for (const status of statuses) {
            await whatsappService.updateMessageStatus(
              status.id,
              status.status,
              status.timestamp
            );
          }
        }
      }
    }

    res.status(200).send('OK');

  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const verifyWhatsAppWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
};
