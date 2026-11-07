import mongoose from "mongoose";

const variableDefinitionSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    label: { type: String, default: "" },
    autoSource: { type: String, default: null },
    locked: { type: Boolean, default: false },
    defaultValue: { type: String, default: "" },
  },
  { _id: false },
);

const buttonSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["URL", "QUICK_REPLY", "PHONE_NUMBER"],
      required: true,
    },
    title: { type: String, required: true },
    url: { type: String, default: "" },
    phone: { type: String, default: "" },
    id: { type: String, default: "" },
  },
  { _id: false },
);

const whatsAppContentTemplateSchema = new mongoose.Schema(
  {
    friendlyName: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, default: "" },
    description: { type: String, default: "" },
    language: { type: String, default: "en" },
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      default: "UTILITY",
    },
    templateType: {
      type: String,
      enum: ["text", "media", "card", "call-to-action", "quick-reply"],
      default: "text",
    },
    headerType: {
      type: String,
      enum: ["none", "text", "media"],
      default: "none",
    },
    headerText: { type: String, default: "" },
    headerMediaUrl: { type: String, default: "" },
    bodyText: { type: String, required: true },
    footerText: { type: String, default: "" },
    buttons: { type: [buttonSchema], default: [] },
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },
    variableDefinitions: { type: [variableDefinitionSchema], default: [] },
    supportsMediaHeader: { type: Boolean, default: false },
    buttonUrlVariableIndex: { type: Number, default: 0 },
    contentSid: { type: String, default: null, index: true },
    approvalStatus: {
      type: String,
      enum: [
        "unsubmitted",
        "pending",
        "received",
        "approved",
        "rejected",
        "failed",
      ],
      default: "unsubmitted",
    },
    approvalRejectionReason: { type: String, default: null },
    twilioApprovalName: { type: String, default: null },
    lastCheckedAt: { type: Date, default: null },
    createdBy: { type: String, default: null },
  },
  { timestamps: true },
);

export const WhatsAppContentTemplate = mongoose.model(
  "WhatsAppContentTemplate",
  whatsAppContentTemplateSchema,
);
