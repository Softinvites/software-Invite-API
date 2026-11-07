import { WhatsAppContentTemplate } from "../models/WhatsAppContentTemplate.js";
import type { VariableDefinition } from "./dynamicTemplateBuilder.js";
import { applyHeaderMediaDefaults } from "./dynamicTemplateBuilder.js";

export type LoadedTemplateInfo = {
  contentSid: string | null;
  variableDefinitions: VariableDefinition[];
  supportsMediaHeader: boolean;
  buttonUrlVariableIndex: number;
};

// Loads a DB-stored Twilio Content template by its friendlyName.
// Returns null if not found or not approved. Callers use this to feed
// `customDefinition` into buildWhatsAppTemplateParams so newly approved
// templates work without any code changes.
export const loadDbTemplateByName = async (
  templateName: string,
): Promise<LoadedTemplateInfo | null> => {
  if (!templateName) return null;
  try {
    const doc = await WhatsAppContentTemplate.findOne({
      friendlyName: templateName,
      approvalStatus: "approved",
    });
    if (!doc) return null;

    const defs = Array.isArray(doc.variableDefinitions)
      ? (doc.variableDefinitions as any[]).map((d) => ({
          index: d.index,
          label: d.label || "",
          autoSource: d.autoSource || null,
          locked: !!d.locked,
          defaultValue: d.defaultValue || "",
        }))
      : [];

    return {
      contentSid: doc.contentSid || null,
      variableDefinitions: applyHeaderMediaDefaults(
        defs,
        (doc as any).headerMediaUrl,
      ),
      supportsMediaHeader: !!doc.supportsMediaHeader,
      buttonUrlVariableIndex: doc.buttonUrlVariableIndex || 0,
    };
  } catch (err) {
    console.warn("loadDbTemplateByName error:", err);
    return null;
  }
};