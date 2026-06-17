import { Request, Response } from "express";
import axios from "axios";
import { WhatsAppContentTemplate } from "../models/WhatsAppContentTemplate.js";
import {
  AUTO_SOURCES,
  VariableDefinition,
} from "../utils/dynamicTemplateBuilder.js";

const VALID_CATEGORIES = new Set(["MARKETING", "UTILITY", "AUTHENTICATION"]);
const NAME_PATTERN = /^[a-z0-9_]{1,64}$/;
const VAR_PATTERN = /\{\{(\d+)\}\}/g;
const VALID_AUTO_SOURCES = new Set<string>([...AUTO_SOURCES]);
const VALID_TEMPLATE_TYPES = new Set([
  "text",
  "media",
  "card",
  "call-to-action",
  "quick-reply",
]);
const VALID_HEADER_TYPES = new Set(["none", "text", "media"]);
const VALID_BUTTON_TYPES = new Set(["URL", "QUICK_REPLY", "PHONE_NUMBER"]);

const TWILIO_CONTENT_API = "https://content.twilio.com/v1";

const getTwilioAuth = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("Twilio credentials not configured");
  }
  return { username: sid, password: token };
};

const extractVariableIndexes = (...sources: (string | null | undefined)[]): number[] => {
  const found = new Set<number>();
  sources.forEach((src) => {
    if (!src) return;
    const re = /\{\{(\d+)\}\}/g;
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = re.exec(src)) !== null) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > 0) found.add(n);
    }
  });
  return [...found].sort((a, b) => a - b);
};

const validateMetaRules = (
  friendlyName: string,
  bodyText: string,
  allVarSources: string[],
): string | null => {
  if (!NAME_PATTERN.test(friendlyName)) {
    return "Template name must be lowercase alphanumeric with underscores only (max 64 chars).";
  }
  if (!bodyText || bodyText.trim().length < 3) {
    return "Body text is required.";
  }

  const vars = extractVariableIndexes(...allVarSources);
  const cleanedBody = bodyText.replace(VAR_PATTERN, "").trim();
  const staticChars = cleanedBody.replace(/\s+/g, " ").length;
  const bodyVars = extractVariableIndexes(bodyText);

  if (bodyVars.length > 0 && staticChars < bodyVars.length * 3) {
    return "Body is too dynamic. Add more static text between variables.";
  }

  for (let i = 0; i < vars.length; i += 1) {
    if (vars[i] !== i + 1) {
      return `Variables must be sequential starting from {{1}}. Found gap at {{${vars[i]}}}.`;
    }
  }

  return null;
};

const normalizeVariableDefinitions = (
  input: any,
  allVarSources: string[],
): VariableDefinition[] => {
  const indexes = extractVariableIndexes(...allVarSources);
  const providedByIndex = new Map<number, any>();

  if (Array.isArray(input)) {
    input.forEach((item) => {
      if (!item) return;
      const idx = Number(item.index);
      if (!Number.isInteger(idx) || idx < 1) return;
      providedByIndex.set(idx, item);
    });
  }

  return indexes.map((idx) => {
    const raw = providedByIndex.get(idx) || {};
    const autoSourceRaw = raw.autoSource == null ? null : String(raw.autoSource);
    const autoSource =
      autoSourceRaw && VALID_AUTO_SOURCES.has(autoSourceRaw)
        ? autoSourceRaw
        : null;
    return {
      index: idx,
      label: String(raw.label || "").trim(),
      autoSource,
      locked: Boolean(raw.locked),
      defaultValue: String(raw.defaultValue || ""),
    };
  });
};

type ButtonInput = {
  type: string;
  title: string;
  url?: string;
  phone?: string;
};

const normalizeButtons = (input: any): ButtonInput[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((b) => ({
      type: String(b?.type || "").toUpperCase(),
      title: String(b?.title || "").trim(),
      url: String(b?.url || "").trim(),
      phone: String(b?.phone || "").trim(),
    }))
    .filter(
      (b) =>
        VALID_BUTTON_TYPES.has(b.type) &&
        b.title.length > 0 &&
        b.title.length <= 25,
    );
};

const buildSampleVariables = (
  body: string,
  allVarSources: string[],
  provided: any,
): Record<string, string> => {
  const indexes = extractVariableIndexes(...allVarSources, body);
  const map: Record<string, string> = {};
  indexes.forEach((n) => {
    const key = String(n);
    const value =
      provided && typeof provided === "object" && provided[key] != null
        ? String(provided[key])
        : "";
    map[key] = value.trim() || `sample_${n}`;
  });
  return map;
};

type TwilioContentPayload = {
  friendly_name: string;
  language: string;
  variables: Record<string, string>;
  types: Record<string, any>;
};

const buildTwilioPayload = (params: {
  friendlyName: string;
  language: string;
  templateType: string;
  headerType: string;
  headerText: string;
  headerMediaUrl: string;
  body: string;
  footer: string;
  buttons: ButtonInput[];
  variables: Record<string, string>;
}): TwilioContentPayload => {
  const {
    friendlyName,
    language,
    templateType,
    headerType,
    headerText,
    headerMediaUrl,
    body,
    footer,
    buttons,
    variables,
  } = params;

  const actions = buttons.map((b) => {
    if (b.type === "URL") return { type: "URL", title: b.title, url: b.url };
    if (b.type === "PHONE_NUMBER")
      return { type: "PHONE_NUMBER", title: b.title, phone: b.phone };
    return { type: "QUICK_REPLY", title: b.title };
  });

  const types: Record<string, any> = {};

  if (templateType === "card") {
    // WhatsApp Card — confirmed against a live working template in this
    // account (e.g. wedding_invite), Twilio's content type key is
    // `whatsapp/card` (no `twilio/` prefix). Schema:
    //   header_text | media[] (mutually exclusive header)
    //   body (required)
    //   footer (optional)
    //   actions: URL / QUICK_REPLY / PHONE_NUMBER
    const card: Record<string, any> = { body };
    if (headerType === "text" && headerText.trim()) {
      card.header_text = headerText.trim();
    }
    if (headerType === "media" && headerMediaUrl.trim()) {
      card.media = [headerMediaUrl.trim()];
    }
    if (footer.trim()) card.footer = footer.trim();
    if (actions.length > 0) card.actions = actions;
    types["whatsapp/card"] = card;
  } else if (templateType === "media") {
    types["twilio/media"] = {
      body,
      media: headerMediaUrl.trim() ? [headerMediaUrl.trim()] : [],
    };
  } else if (templateType === "call-to-action") {
    types["twilio/call-to-action"] = {
      body,
      actions: actions.filter((a) => a.type !== "QUICK_REPLY"),
    };
  } else if (templateType === "quick-reply") {
    types["twilio/quick-reply"] = {
      body,
      actions: actions.filter((a) => a.type === "QUICK_REPLY"),
    };
  } else {
    types["twilio/text"] = { body };
  }

  return {
    friendly_name: friendlyName,
    language,
    variables,
    types,
  };
};

const submitContentForApproval = async (
  contentSid: string,
  friendlyName: string,
  category: string,
) => {
  const { data } = await axios.post(
    `${TWILIO_CONTENT_API}/Content/${contentSid}/ApprovalRequests/whatsapp`,
    { name: friendlyName, category },
    { auth: getTwilioAuth() },
  );
  return data;
};

export const createContentTemplate = async (req: Request, res: Response) => {
  try {
    const {
      friendlyName,
      displayName,
      description,
      language,
      category,
      templateType: rawType,
      headerType: rawHeaderType,
      headerText: rawHeaderText,
      headerMediaUrl: rawHeaderMediaUrl,
      bodyText,
      footerText: rawFooterText,
      buttons: rawButtons,
      variableDefinitions,
      sampleVariables,
    } = req.body || {};

    const cleanName = String(friendlyName || "").trim().toLowerCase();
    const cleanBody = String(bodyText || "");
    const templateType = VALID_TEMPLATE_TYPES.has(String(rawType))
      ? String(rawType)
      : "text";
    const headerType = VALID_HEADER_TYPES.has(String(rawHeaderType))
      ? String(rawHeaderType)
      : "none";
    const headerText = String(rawHeaderText || "");
    const headerMediaUrl = String(rawHeaderMediaUrl || "");
    const footerText = String(rawFooterText || "");
    const buttons = normalizeButtons(rawButtons);

    const allVarSources = [
      cleanBody,
      headerType === "text" ? headerText : "",
      headerType === "media" ? headerMediaUrl : "",
      ...buttons.map((b) => b.url || ""),
    ];

    const validationError = validateMetaRules(cleanName, cleanBody, allVarSources);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const normalizedCategory = String(category || "UTILITY").trim().toUpperCase();
    if (!VALID_CATEGORIES.has(normalizedCategory)) {
      return res.status(400).json({
        message: "Category must be MARKETING, UTILITY, or AUTHENTICATION.",
      });
    }

    // Per-type sanity checks
    if (templateType === "card") {
      if (headerType === "text" && !headerText.trim()) {
        return res.status(400).json({
          message: "Header text is required when header type is 'text'.",
        });
      }
      if (headerType === "media" && !headerMediaUrl.trim()) {
        return res
          .status(400)
          .json({ message: "Header media URL is required when header type is 'media'." });
      }
    }
    if (templateType === "media" && !headerMediaUrl.trim()) {
      return res
        .status(400)
        .json({ message: "Media URL is required for 'media' template type." });
    }
    if (templateType === "call-to-action" && buttons.filter((b) => b.type !== "QUICK_REPLY").length === 0) {
      return res
        .status(400)
        .json({ message: "Add at least one URL or phone button." });
    }
    if (templateType === "quick-reply" && buttons.filter((b) => b.type === "QUICK_REPLY").length === 0) {
      return res
        .status(400)
        .json({ message: "Add at least one quick-reply button." });
    }

    const existing = await WhatsAppContentTemplate.findOne({
      friendlyName: cleanName,
    });
    if (existing) {
      return res
        .status(409)
        .json({ message: "A template with this name already exists." });
    }

    const langCode = String(language || "en");
    const variablesMap = buildSampleVariables(cleanBody, allVarSources, sampleVariables);
    const definitions = normalizeVariableDefinitions(
      variableDefinitions,
      allVarSources,
    );

    const payload = buildTwilioPayload({
      friendlyName: cleanName,
      language: langCode,
      templateType,
      headerType,
      headerText,
      headerMediaUrl,
      body: cleanBody,
      footer: footerText,
      buttons,
      variables: variablesMap,
    });

    // 1) Create Content resource on Twilio
    const { data: content } = await axios.post(
      `${TWILIO_CONTENT_API}/Content`,
      payload,
      { auth: getTwilioAuth() },
    );

    const contentSid: string | null = content?.sid || null;

    // 2) Immediately submit for WhatsApp approval (the user's described flow
    //    has a single final Submit that creates + sends for approval).
    let approval: any = null;
    let approvalStatus: any = "unsubmitted";
    let approvalError: string | null = null;
    if (contentSid) {
      try {
        approval = await submitContentForApproval(
          contentSid,
          cleanName,
          normalizedCategory,
        );
        approvalStatus = String(
          approval?.status || "pending",
        ).toLowerCase();
      } catch (approvalErr: any) {
        approvalError =
          approvalErr?.response?.data?.message ||
          approvalErr?.message ||
          "Approval submission failed.";
        console.error(
          "[createContentTemplate] Approval submission failed:",
          approvalErr?.response?.data || approvalErr?.message,
        );
      }
    }

    const template = await WhatsAppContentTemplate.create({
      friendlyName: cleanName,
      displayName: String(displayName || "").trim(),
      description: String(description || "").trim(),
      language: langCode,
      category: normalizedCategory,
      templateType,
      headerType,
      headerText,
      headerMediaUrl,
      bodyText: cleanBody,
      footerText,
      buttons,
      variables: variablesMap,
      variableDefinitions: definitions,
      supportsMediaHeader: headerType === "media",
      contentSid,
      twilioApprovalName: contentSid ? cleanName : null,
      approvalStatus,
      lastCheckedAt: approval ? new Date() : null,
      createdBy: (req as any).user?.id || null,
    });

    return res.status(201).json({ template, approval, approvalError });
  } catch (err: any) {
    console.error("createContentTemplate error:", err?.response?.data || err);
    return res.status(500).json({
      message:
        err?.response?.data?.message ||
        err?.message ||
        "Failed to create template.",
      details: err?.response?.data || err?.code || null,
    });
  }
};

export const updateContentTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await WhatsAppContentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }

    const {
      displayName,
      description,
      category,
      variableDefinitions,
      buttonUrlVariableIndex,
    } = req.body || {};

    if (typeof displayName === "string") template.displayName = displayName.trim();
    if (typeof description === "string") template.description = description.trim();
    if (category !== undefined) {
      const normalizedCategory = String(category || "UTILITY")
        .trim()
        .toUpperCase();
      if (!VALID_CATEGORIES.has(normalizedCategory)) {
        return res.status(400).json({
          message: "Category must be MARKETING, UTILITY, or AUTHENTICATION.",
        });
      }
      template.category = normalizedCategory as any;
    }
    if (variableDefinitions !== undefined) {
      const allVarSources = [
        template.bodyText,
        template.headerType === "text" ? template.headerText || "" : "",
        template.headerType === "media" ? template.headerMediaUrl || "" : "",
        ...(template.buttons || []).map((b: any) => b?.url || ""),
      ];
      template.variableDefinitions = normalizeVariableDefinitions(
        variableDefinitions,
        allVarSources,
      ) as any;
    }
    if (buttonUrlVariableIndex !== undefined) {
      template.buttonUrlVariableIndex = Number.isInteger(buttonUrlVariableIndex)
        ? Number(buttonUrlVariableIndex)
        : 0;
    }

    await template.save();
    return res.status(200).json({ template });
  } catch (err: any) {
    console.error("updateContentTemplate error:", err);
    return res.status(500).json({
      message: err?.message || "Failed to update template.",
    });
  }
};

export const submitForApproval = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await WhatsAppContentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }
    if (!template.contentSid) {
      return res
        .status(400)
        .json({ message: "Template has no Twilio Content SID." });
    }

    const approval = await submitContentForApproval(
      template.contentSid,
      template.friendlyName,
      template.category,
    );

    template.twilioApprovalName = template.friendlyName;
    template.approvalStatus = String(
      approval?.status || "pending",
    ).toLowerCase() as any;
    template.lastCheckedAt = new Date();
    await template.save();

    return res.status(200).json({ template, approval });
  } catch (err: any) {
    console.error("submitForApproval error:", err);
    return res.status(500).json({
      message:
        err?.response?.data?.message ||
        err?.message ||
        "Failed to submit template for approval.",
    });
  }
};

export const refreshApprovalStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await WhatsAppContentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }
    if (!template.contentSid) {
      return res
        .status(400)
        .json({ message: "Template has no Twilio Content SID." });
    }

    const { data: fetched } = await axios.get(
      `${TWILIO_CONTENT_API}/Content/${template.contentSid}/ApprovalRequests`,
      { auth: getTwilioAuth() },
    );

    const whatsapp = fetched?.whatsapp || {};
    const nextStatus = String(
      whatsapp?.status || fetched?.status || "pending",
    ).toLowerCase();

    template.approvalStatus = nextStatus as any;
    template.approvalRejectionReason = whatsapp?.rejection_reason || null;
    template.lastCheckedAt = new Date();
    await template.save();

    return res.status(200).json({ template, raw: fetched });
  } catch (err: any) {
    console.error("refreshApprovalStatus error:", err);
    return res.status(500).json({
      message:
        err?.response?.data?.message ||
        err?.message ||
        "Failed to refresh template status.",
    });
  }
};

export const listContentTemplates = async (_req: Request, res: Response) => {
  try {
    const templates = await WhatsAppContentTemplate.find().sort({
      createdAt: -1,
    });
    return res.status(200).json({ templates });
  } catch (err: any) {
    console.error("listContentTemplates error:", err);
    return res.status(500).json({ message: "Failed to list templates." });
  }
};

export const inspectTwilioContent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await WhatsAppContentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }
    if (!template.contentSid) {
      return res
        .status(400)
        .json({ message: "Template has no Twilio Content SID." });
    }

    const { data } = await axios.get(
      `${TWILIO_CONTENT_API}/Content/${template.contentSid}`,
      { auth: getTwilioAuth() },
    );

    // Twilio returns the full content with `types` showing whatever key it
    // registered (e.g. "twilio/whatsapp-card"). Surface this so the user
    // can verify the template was created as a WhatsApp Card.
    return res.status(200).json({
      friendlyName: template.friendlyName,
      contentSid: template.contentSid,
      registeredTypes: Object.keys(data?.types || {}),
      raw: data,
    });
  } catch (err: any) {
    console.error("inspectTwilioContent error:", err?.response?.data || err);
    return res.status(500).json({
      message:
        err?.response?.data?.message ||
        err?.message ||
        "Failed to inspect Twilio content.",
    });
  }
};

export const getContentTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await WhatsAppContentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }
    return res.status(200).json({ template });
  } catch (err: any) {
    console.error("getContentTemplate error:", err);
    return res.status(500).json({ message: "Failed to fetch template." });
  }
};

export const deleteContentTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await WhatsAppContentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found." });
    }

    if (template.contentSid) {
      try {
        await axios.delete(
          `${TWILIO_CONTENT_API}/Content/${template.contentSid}`,
          { auth: getTwilioAuth() },
        );
      } catch (twilioErr: any) {
        console.warn(
          "Twilio content remove failed (continuing with DB delete):",
          twilioErr?.message,
        );
      }
    }

    await WhatsAppContentTemplate.findByIdAndDelete(id);
    return res.status(200).json({ message: "Template deleted." });
  } catch (err: any) {
    console.error("deleteContentTemplate error:", err);
    return res.status(500).json({ message: "Failed to delete template." });
  }
};
