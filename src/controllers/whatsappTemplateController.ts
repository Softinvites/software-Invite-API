import { Request, Response } from "express";
import { WhatsAppTemplate } from "../models/WhatsAppTemplate.js";
import { WhatsAppContentTemplate } from "../models/WhatsAppContentTemplate.js";
import { Event } from "../models/eventmodel.js";
import { RSVP } from "../models/rsvpmodel.js";
import { RSVPChannelPreference } from "../models/rsvpChannelPreference.js";
import whatsappService from "../utils/whatsappService.js";
import {
  buildWhatsAppTemplateParams,
  getDefaultWhatsAppTemplateName,
} from "../utils/whatsappTemplateParams.js";
import {
  isEffectivelyLocked,
  applyHeaderMediaDefaults,
} from "../utils/dynamicTemplateBuilder.js";

// Locked variable indexes for the hardcoded templates — kept here so the
// /template-samples response can advertise lockedVariableIndexes for both
// hardcoded and DB-stored templates uniformly.
const LEGACY_LOCKED_VARIABLES: Record<string, number[]> = {
  wedding_invite: [2, 10, 11],
  rsvp_followup: [1, 6],
  rsvp_party: [2, 7, 8, 9],
  rsvp_wedding: [2, 9, 10, 11],
  rsvp_form: [2, 7, 8],
  event_details_reminder: [1],
  logistics: [1],
};

type WhatsAppTemplateCategory = "marketing" | "utility" | "authentication";

type RecommendedTemplateDefinition = {
  templateName: string;
  title: string;
  category: WhatsAppTemplateCategory;
  description: string;
  expectedVariableCount: number;
  buttonUrlVariableIndex: number;
  bodySkeleton: string;
  supportsMediaHeader: boolean;
};

const RECOMMENDED_TEMPLATE_DEFINITIONS: RecommendedTemplateDefinition[] = [
  {
    templateName: "wedding_invite",
    title: "Wedding Invite (Media + Pass Button)",
    category: "marketing",
    description:
      "Primary invitation template with a media header and a dynamic pass button URL.",
    expectedVariableCount: 11,
    buttonUrlVariableIndex: 11,
    supportsMediaHeader: true,
    bodySkeleton:
      "Invitation to {{1}}.\n\nDear {{2}},\n\nThe {{3}} cordially invite you to the {{4}} of their children {{5}}.\n\n{{6}} Details are as follows\nDate: {{7}}\nTime: {{8}}\nVenue: {{9}}\n\nMedia: https://softinvites-assets.s3.us-east-2.amazonaws.com/{{10}}\nPass: https://softinvites-assets.s3.us-east-2.amazonaws.com/qr_codes/email_png/{{11}}",
  },
  {
    templateName: "event_details_reminder",
    title: "Event Details Reminder",
    category: "utility",
    description:
      "Utility reminder template for event details (no buttons, no media header).",
    expectedVariableCount: 5,
    buttonUrlVariableIndex: 0,
    supportsMediaHeader: false,
    bodySkeleton:
      "Event Reminder\n\nHello {{1}},\n\nThis is a reminder for {{2}}.\n\nVenue: {{3}}\nDate: {{4}}\nTime: {{5}}\n\nWe look forward to seeing you there.",
  },
  {
    templateName: "rsvp_followup",
    title: "RSVP Follow-up",
    category: "utility",
    description:
      "Utility follow-up that includes a dynamic pass button URL (suffix mode).",
    expectedVariableCount: 6,
    buttonUrlVariableIndex: 6,
    supportsMediaHeader: false,
    bodySkeleton:
      "RSVP Follow-Up\n\nHello {{1}},\n\nWe're excited about the upcoming event: {{2}}.\n\nVenue: {{3}}\nDate: {{4}}\nTime: {{5}}\n\nButton: https://softinvites-assets.s3.us-east-2.amazonaws.com/qr_codes/email_png/{{6}}",
  },
  {
    templateName: "logistics",
    title: "Logistics",
    category: "utility",
    description: "Utility template for logistics / support information.",
    expectedVariableCount: 2,
    buttonUrlVariableIndex: 0,
    supportsMediaHeader: false,
    bodySkeleton:
      "Dear {{1}},\n\nYou are invited to the wedding celebration of {{2}}.\n\nParking: Available inside and opposite the venue.",
  },
  {
    templateName: "rsvp_party",
    title: "RSVP Party (Media + RSVP Buttons)",
    category: "utility",
    description:
      "Party invitation with media header and Yes/No RSVP buttons. Guest name, header image, and RSVP links are set automatically.",
    expectedVariableCount: 9,
    buttonUrlVariableIndex: 8,
    supportsMediaHeader: true,
    bodySkeleton:
      "Invitation to {{1}} Party.\n\nDear {{2}},\n\nYou are cordially invited to {{3}} Party.\n\nDate: {{4}}\nTime: {{5}}\nVenue: {{6}}\n\nMedia: https://softinvites-assets.s3.us-east-2.amazonaws.com/{{7}}\nYes: https://www.softinvite.com/rsvp/respond/{{8}}\nNo: https://www.softinvite.com/rsvp/respond/{{9}}",
  },
  {
    templateName: "rsvp_wedding",
    title: "RSVP Wedding (Media + RSVP Buttons)",
    category: "utility",
    description:
      "Wedding invitation with media header and Yes/No RSVP buttons. Guest name, header image, and RSVP links are set automatically.",
    expectedVariableCount: 11,
    buttonUrlVariableIndex: 10,
    supportsMediaHeader: true,
    bodySkeleton:
      "Invitation to {{1}}.\n\nDear {{2}},\n\nThe {{3}} cordially invite you to the {{4}} of their children {{5}}.\n\nDate: {{6}}\nTime: {{7}}\nVenue: {{8}}\n\nMedia: https://softinvites-assets.s3.us-east-2.amazonaws.com/{{9}}\nYes: https://www.softinvite.com/rsvp/respond/{{10}}\nNo: https://www.softinvite.com/rsvp/respond/{{11}}",
  },
  {
    templateName: "rsvp_form",
    title: "RSVP Form (Media + Form Button)",
    category: "utility",
    description:
      "Party invitation with media header and RSVP form button. Guest name, header image, and form link are auto-generated.",
    expectedVariableCount: 8,
    buttonUrlVariableIndex: 8,
    supportsMediaHeader: true,
    bodySkeleton:
      "Invitation to {{1}} Party.\n\nDear {{2}},\n\nYou are cordially invited to {{3}} Party.\n\nDate: {{4}}\nTime: {{5}}\nVenue: {{6}}\n\nMedia: https://softinvites-assets.s3.us-east-2.amazonaws.com/{{7}}\nRSVP: https://www.softinvite.com/r/{{8}}",
  },
];

const buildSamplePassUrl = (eventId: string, guestId: string) => {
  const bucket = process.env.S3_BUCKET || "softinvites-assets";
  const region = process.env.AWS_REGION || "us-east-2";
  return `https://${bucket}.s3.${region}.amazonaws.com/qr_codes/email_png/${eventId}/${guestId}.png`;
};

const TEMPLATE_VARIABLE_LABELS: Record<string, Record<number, string>> = {
  event_details_reminder: {
    1: "Guest Name (auto)",
    2: "Event Title",
    3: "Venue",
    4: "Date",
    5: "Time",
  },
  rsvp_followup: {
    1: "Guest Name (auto)",
    2: "Event Title",
    3: "Venue",
    4: "Date",
    5: "Time",
    6: "QR Pass URL (auto)",
  },
  logistics: {
    1: "Guest Name (auto)",
    2: "Event Title",
  },
  wedding_invite: {
    1: "Event Title",
    2: "Guest Name (auto)",
    3: "Couple's Family Name",
    4: "Event Type (e.g. Church Wedding)",
    5: "Couple's Names",
    6: "Ceremony Label (e.g. Church Ceremony)",
    7: "Date",
    8: "Time",
    9: "Venue",
    10: "Invitation Image (auto)",
    11: "QR Pass ID (auto)",
  },
  rsvp_wedding: {
    1: "Event Title",
    2: "Guest Name (auto)",
    3: "Couple's Family Name",
    4: "Event Type (e.g. Traditional Wedding)",
    5: "Couple's Names",
    6: "Date",
    7: "Time",
    8: "Venue",
    9: "Invitation Image (auto)",
    10: "RSVP Yes Link (auto)",
    11: "RSVP No Link (auto)",
  },
  rsvp_party: {
    1: "Event Title",
    2: "Guest Name (auto)",
    3: "Event Title",
    4: "Date",
    5: "Time",
    6: "Venue",
    7: "Invitation Image (auto)",
    8: "RSVP Yes Link (auto)",
    9: "RSVP No Link (auto)",
  },
  rsvp_form: {
    1: "Event Title",
    2: "Guest Name (auto)",
    3: "Event Title",
    4: "Date",
    5: "Time",
    6: "Venue",
    7: "Invitation Image (auto)",
    8: "RSVP Form Link (auto)",
  },
};

type CreateTemplateInput = {
  name?: string;
  displayName?: string;
  provider?: string | null;
  contentSid?: string | null;
  statusCallbackUrl?: string | null;
  language?: string | null;
  category?: string | null;
  components?: any[];
  status?: string | null;
  isActive?: boolean;
};

const VALID_TEMPLATE_CATEGORIES = new Set([
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION",
]);
const VALID_TEMPLATE_PROVIDERS = new Set(["meta", "twilio", "termii"]);
const VALID_TEMPLATE_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

const normalizeTemplateCategory = (value: unknown, fallback = "UTILITY") => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return VALID_TEMPLATE_CATEGORIES.has(normalized) ? normalized : fallback;
};

const normalizeTemplateProvider = (value: unknown) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return VALID_TEMPLATE_PROVIDERS.has(normalized) ? normalized : null;
};

const normalizeTemplateStatus = (value: unknown, fallback = "APPROVED") => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return VALID_TEMPLATE_STATUSES.has(normalized) ? normalized : fallback;
};

const getTwilioContentSidEnvKey = (templateName: string) =>
  `TWILIO_CONTENT_SID_${String(templateName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")}`;

const buildRecommendedTemplateInputs = (
  payload: Record<string, any>,
): CreateTemplateInput[] => {
  const contentSidMap =
    payload?.contentSidMap && typeof payload.contentSidMap === "object"
      ? payload.contentSidMap
      : {};
  const statusCallbackUrlMap =
    payload?.statusCallbackUrlMap &&
    typeof payload.statusCallbackUrlMap === "object"
      ? payload.statusCallbackUrlMap
      : {};
  const componentsMap =
    payload?.componentsMap && typeof payload.componentsMap === "object"
      ? payload.componentsMap
      : {};

  return RECOMMENDED_TEMPLATE_DEFINITIONS.map((definition) => {
    const templateName = definition.templateName;
    const envContentSid =
      process.env[getTwilioContentSidEnvKey(templateName)] || null;
    const contentSid =
      contentSidMap[templateName] ??
      payload?.contentSid ??
      envContentSid ??
      null;
    const statusCallbackUrl =
      statusCallbackUrlMap[templateName] ??
      payload?.statusCallbackUrl ??
      process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL ??
      null;

    return {
      name: templateName,
      displayName: definition.title,
      provider: payload?.provider || "twilio",
      contentSid,
      statusCallbackUrl,
      language: payload?.language || "en_US",
      category: normalizeTemplateCategory(definition.category, "UTILITY"),
      components: Array.isArray(componentsMap?.[templateName])
        ? componentsMap[templateName]
        : [],
      status: payload?.status || "APPROVED",
      isActive:
        payload?.isActive !== undefined ? payload.isActive === true : true,
    };
  });
};

const resolveTemplateCreateInputs = (
  payload: Record<string, any>,
): CreateTemplateInput[] => {
  if (Array.isArray(payload?.templates) && payload.templates.length) {
    return payload.templates;
  }

  if (payload?.useRecommended === true) {
    return buildRecommendedTemplateInputs(payload);
  }

  return [payload];
};

export const createWhatsAppTemplate = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const payload = (req.body || {}) as Record<string, any>;
    const upsert = payload.upsert !== false;
    const inputs = resolveTemplateCreateInputs(payload);

    if (!inputs.length) {
      return res.status(400).json({
        message: "No template payload supplied",
      });
    }

    const validationErrors: string[] = [];
    const resultTemplates: any[] = [];
    const createdNames: string[] = [];
    const updatedNames: string[] = [];

    for (const input of inputs) {
      const name = String(input?.name || "").trim();
      const displayName = String(input?.displayName || "").trim();

      if (!name || !displayName) {
        validationErrors.push(
          `Each template requires name and displayName (received name="${name}", displayName="${displayName}")`,
        );
        continue;
      }

      const filter = { eventId, name };
      const updatePayload = {
        eventId,
        name,
        displayName,
        provider: normalizeTemplateProvider(input?.provider),
        contentSid: String(input?.contentSid || "").trim() || null,
        statusCallbackUrl:
          String(input?.statusCallbackUrl || "").trim() || null,
        language: String(input?.language || "en_US").trim() || "en_US",
        category: normalizeTemplateCategory(input?.category),
        components: Array.isArray(input?.components) ? input.components : [],
        status: normalizeTemplateStatus(input?.status),
        isActive:
          input?.isActive !== undefined ? input.isActive === true : true,
      };

      if (upsert) {
        const existing = await WhatsAppTemplate.findOne(filter)
          .select({ _id: 1 })
          .lean();
        const template = await WhatsAppTemplate.findOneAndUpdate(
          filter,
          { $set: updatePayload },
          { upsert: true, new: true, runValidators: true },
        );
        if (existing) {
          updatedNames.push(name);
        } else {
          createdNames.push(name);
        }
        resultTemplates.push(template);
      } else {
        const template = await WhatsAppTemplate.create(updatePayload);
        createdNames.push(name);
        resultTemplates.push(template);
      }
    }

    if (validationErrors.length) {
      return res.status(400).json({
        message: "Template validation failed",
        errors: validationErrors,
      });
    }

    return res.status(201).json({
      message: upsert
        ? "WhatsApp templates created/updated successfully"
        : "WhatsApp templates created successfully",
      count: resultTemplates.length,
      created: createdNames,
      updated: updatedNames,
      templates: resultTemplates,
    });
  } catch (error: any) {
    console.error("createWhatsAppTemplate error", error);
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "Template already exists",
        hint: "If this conflicts across different events, drop legacy unique index name_1 and keep compound index eventId_1_name_1.",
        error: error?.message || "Duplicate template",
      });
    }
    return res.status(500).json({
      message: "Failed to create WhatsApp template",
      error: error?.message || String(error),
    });
  }
};

export const listWhatsAppTemplates = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const templates = await WhatsAppTemplate.find({ eventId }).sort({
      createdAt: -1,
    });
    return res.json({ templates });
  } catch (error: any) {
    console.error("listWhatsAppTemplates error", error);
    return res
      .status(500)
      .json({ message: "Failed to load WhatsApp templates" });
  }
};

export const sendWhatsAppBroadcast = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { templateName = getDefaultWhatsAppTemplateName(), rsvpIds } =
      req.body || {};
    const rsvpPublicBaseUrl = (
      process.env.RSVP_PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      ""
    ).replace(/\/$/, "");

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
      if (
        (event as any)?.channelConfig?.whatsapp?.optInRequired &&
        !pref?.whatsappOptIn
      ) {
        skipped += 1;
        continue;
      }

      const eventIdValue = String((event as any)._id || eventId);
      const rsvpLink =
        rsvp.token && rsvpPublicBaseUrl
          ? `${rsvpPublicBaseUrl}/rsvp/${rsvp.token}`
          : "";
      const passUrl =
        /^rsvp_followup/i.test(templateName) ||
        /^wedding_invite/i.test(templateName)
          ? buildSamplePassUrl(
              eventIdValue,
              String((rsvp as any)?.guestId || rsvp._id),
            )
          : /^rsvp_party/i.test(templateName) ||
              /^rsvp_wedding/i.test(templateName)
            ? String(rsvp._id) // raw RSVP _id — button URL has ?status=yes/no hardcoded in template
            : rsvpLink || event.iv || "";
      const templateParams = buildWhatsAppTemplateParams({
        templateName,
        recipientName: rsvp.guestName,
        eventName: event.name,
        location: event.location || "",
        eventDate: event.date || "",
        passUrl,
        eventIv: event.iv || null,
      });
      await whatsappService.sendTemplateMessage(
        rsvp.phone,
        templateName,
        templateParams,
        rsvp._id.toString(),
        eventIdValue,
        /^wedding_invite/i.test(templateName)
          ? { mediaUrl: event.iv || null }
          : {},
      );
      sent += 1;
    }

    return res.json({
      message: "WhatsApp broadcast sent",
      sent,
      skipped,
      total: rsvps.length,
    });
  } catch (error: any) {
    console.error("sendWhatsAppBroadcast error", error);
    return res
      .status(500)
      .json({ message: "Failed to send WhatsApp broadcast" });
  }
};

export const getRecommendedWhatsAppTemplateSamples = async (
  req: Request,
  res: Response,
) => {
  try {
    const { eventId } = req.params;
    if (!eventId) {
      return res.status(400).json({ message: "eventId is required" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const sampleGuestName = String(req.query.guestName || "Stanley Offor");
    const sampleSignoff = String(req.query.signoff || "The Couple");
    const sampleLocation = String(event.location || "Lekki, Lagos");
    const sampleDate = String(event.date || "Friday, April 17th, 2026");
    const sampleEventName = String(event.name || "Your Event");
    const samplePassUrl = String(
      req.query.passUrl ||
        buildSamplePassUrl(String(event._id), "sample-guest-id"),
    );
    const sampleHeader = String(req.query.header || sampleEventName);

    // Only templates built in the WhatsApp Template Manager are offered.
    // The hardcoded RECOMMENDED_TEMPLATE_DEFINITIONS are no longer listed —
    // they remain in the codebase solely so that messages already scheduled
    // against those names keep resolving their parameters at send time.
    const INCLUDE_LEGACY_TEMPLATES = false;

    const legacyTemplates: Record<string, any>[] = RECOMMENDED_TEMPLATE_DEFINITIONS.map((definition) => {
      const sampleParametersArray = buildWhatsAppTemplateParams({
        templateName: definition.templateName,
        recipientName: sampleGuestName,
        eventName: sampleEventName,
        location: sampleLocation,
        eventDate: sampleDate,
        passUrl: samplePassUrl,
        signoff: sampleSignoff,
        headerValue: sampleHeader,
        eventIv: event.iv || null,
      });

      const sampleParameters = sampleParametersArray.reduce(
        (acc, value, index) => {
          acc[`{{${index + 1}}}`] = value;
          return acc;
        },
        {} as Record<string, string>,
      );

      return {
        ...definition,
        sampleParametersArray,
        sampleParameters,
        variableLabels: TEMPLATE_VARIABLE_LABELS[definition.templateName] || {},
        lockedVariableIndexes: LEGACY_LOCKED_VARIABLES[definition.templateName] || [],
      };
    });

    const templates: Record<string, any>[] = INCLUDE_LEGACY_TEMPLATES
      ? legacyTemplates
      : [];

    // Merge in DB-stored Twilio Content templates so new ones automatically
    // appear without code changes. Include anything that has been registered
    // on Twilio (has a contentSid). The approvalStatus is exposed alongside
    // each entry so the UI can show a warning / skip sending for unapproved
    // templates.
    try {
      const dbTemplates = await WhatsAppContentTemplate.find({
        contentSid: { $ne: null },
        approvalStatus: { $in: ["approved", "pending", "received"] },
      });

      dbTemplates.forEach((dbT) => {
        // An APPROVED Manager template overrides a hardcoded one of the same
        // name (e.g. a freshly created rsvp_followup replaces the built-in).
        // Pending/received Manager templates do NOT override — the hardcoded
        // one stays until the new one is approved. If no hardcoded entry
        // exists, the Manager template is simply added. This keeps behavior
        // identical when no Manager template is present.
        const existingIdx = templates.findIndex(
          (t) => t.templateName === dbT.friendlyName,
        );
        if (existingIdx !== -1) {
          if (dbT.approvalStatus !== "approved") {
            return; // not approved yet — keep the hardcoded definition
          }
          templates.splice(existingIdx, 1); // approved — replace it below
        }
        const defs = applyHeaderMediaDefaults(
          Array.isArray(dbT.variableDefinitions)
            ? (dbT.variableDefinitions as any[]).map((d) => ({
                index: d.index,
                label: d.label || "",
                autoSource: d.autoSource || null,
                locked: !!d.locked,
                defaultValue: d.defaultValue || "",
              }))
            : [],
          (dbT as any).headerMediaUrl,
        );

        const sampleParametersArray = buildWhatsAppTemplateParams({
          templateName: dbT.friendlyName,
          recipientName: sampleGuestName,
          eventName: sampleEventName,
          location: sampleLocation,
          eventDate: sampleDate,
          passUrl: samplePassUrl,
          signoff: sampleSignoff,
          headerValue: sampleHeader,
          eventIv: event.iv || null,
          customDefinition: defs,
        });

        const sampleParameters = sampleParametersArray.reduce(
          (acc, value, index) => {
            acc[`{{${index + 1}}}`] = value;
            return acc;
          },
          {} as Record<string, string>,
        );

        const variableLabels: Record<number, string> = {};
        defs.forEach((d: any) => {
          if (d.label) variableLabels[d.index] = d.label;
        });

        // Not just the author's checkbox: per-guest and system-derived sources
        // (header media, QR pass, table no, RSVP links) are always locked, so
        // the Send dialog never offers them as editable.
        const lockedIndexes = defs
          .filter((d: any) => isEffectivelyLocked(d))
          .map((d: any) => d.index);

        templates.push({
          templateName: dbT.friendlyName,
          title: dbT.displayName || dbT.friendlyName,
          category: String(dbT.category || "UTILITY").toLowerCase() as any,
          description: dbT.description || "",
          expectedVariableCount: defs.length || sampleParametersArray.length,
          buttonUrlVariableIndex: dbT.buttonUrlVariableIndex || 0,
          bodySkeleton: dbT.bodyText,
          supportsMediaHeader: !!dbT.supportsMediaHeader,
          approvalStatus: dbT.approvalStatus,
          sampleParametersArray,
          sampleParameters,
          variableLabels,
          lockedVariableIndexes: lockedIndexes,
        });
      });
    } catch (dbErr) {
      console.warn("Failed to merge DB content templates:", dbErr);
    }

    return res.status(200).json({
      eventId,
      providerDefaultTemplate: getDefaultWhatsAppTemplateName(),
      mappingRules: {
        templateRules:
          "This endpoint returns the recommended SoftInvites template skeletons + a sample {{n}} mapping. Your Twilio/Meta template variable numbering must match these arrays.",
        qrSuffixRule:
          "Templates with a button URL like https://.../qr_codes/email_png/{{n}} must receive only the suffix (eventId/guestId.png) in that variable. SoftInvites defaults rsvp_followup + wedding_invite + event_pass to qr_email_png_suffix mode.",
        mediaHeaderRule:
          "Media headers require a real, publicly reachable HTTPS URL for template approval. In Twilio templates, the media URL cannot be just {{n}} — keep the domain static and put variables only in the path (e.g., https://bucket.s3.../{{9}}).",
      },
      templates,
    });
  } catch (error: any) {
    console.error("getRecommendedWhatsAppTemplateSamples error", error);
    return res.status(500).json({
      message: "Failed to load WhatsApp template samples",
      error: error?.message || String(error),
    });
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
