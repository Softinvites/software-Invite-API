import { Request, Response } from "express";
import { EmailTemplate } from "../models/emailTemplate";

export const createEmailTemplate = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { name, subject, html } = req.body || {};
    if (!name || !subject || !html) {
      return res.status(400).json({ message: "name, subject, html are required" });
    }
    const template = await EmailTemplate.create({ eventId, name, subject, html });
    return res.status(201).json({ template });
  } catch (error: any) {
    console.error("createEmailTemplate error", error);
    return res.status(500).json({ message: "Failed to create template" });
  }
};

export const listEmailTemplates = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const templates = await EmailTemplate.find({ eventId }).sort({ createdAt: -1 });
    return res.json({ templates });
  } catch (error: any) {
    console.error("listEmailTemplates error", error);
    return res.status(500).json({ message: "Failed to load templates" });
  }
};

export const updateEmailTemplate = async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const { name, subject, html } = req.body || {};
    const update: any = {};
    if (name !== undefined) update.name = name;
    if (subject !== undefined) update.subject = subject;
    if (html !== undefined) update.html = html;
    const template = await EmailTemplate.findByIdAndUpdate(templateId, update, { new: true });
    if (!template) return res.status(404).json({ message: "Template not found" });
    return res.json({ template });
  } catch (error: any) {
    console.error("updateEmailTemplate error", error);
    return res.status(500).json({ message: "Failed to update template" });
  }
};

export const deleteEmailTemplate = async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const template = await EmailTemplate.findByIdAndDelete(templateId);
    if (!template) return res.status(404).json({ message: "Template not found" });
    return res.json({ message: "Template deleted" });
  } catch (error: any) {
    console.error("deleteEmailTemplate error", error);
    return res.status(500).json({ message: "Failed to delete template" });
  }
};
