import { Request, Response } from "express";
import xlsx from "xlsx";
import PDFDocument from "pdfkit";
import { v4 as uuidv4 } from "uuid";
import { RSVP } from "../models/rsvpmodel";
import { Event } from "../models/eventmodel";
import { Report } from "../models/report";
import { uploadToS3 } from "../utils/s3Utils";

const buildReportRows = (rsvps: any[]) =>
  rsvps.map((r) => ({
    RSVP_ID: r._id.toString(),
    Guest: r.guestName || "",
    Email: r.email || "",
    Phone: r.phone || "",
    Status: r.attendanceStatus || "pending",
    Comments: r.comments || "",
    Source: r.source || "",
    SubmittedAt: r.submissionDate ? new Date(r.submissionDate).toISOString() : "",
  }));

const buildPdfBuffer = async (event: any, rows: any[]) => {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  doc.fontSize(18).text(`RSVP Report: ${event.name}`, { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Event Date: ${event.date || "N/A"}`);
  doc.text(`Generated At: ${new Date().toLocaleString()}`);
  doc.moveDown();

  const header = ["Guest", "Email", "Phone", "Status"];
  doc.fontSize(10).text(header.join(" | "));
  doc.moveDown(0.5);

  rows.forEach((row) => {
    doc.text(
      `${row.Guest} | ${row.Email} | ${row.Phone} | ${row.Status}`,
      { width: 520 },
    );
  });

  doc.end();

  return await new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
};

export const generateRsvpReport = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { type = "excel" } = req.body || {};

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    if ((event as any).servicePackage === "invitation-only") {
      return res
        .status(400)
        .json({ message: "Reports are not available for invitation-only events" });
    }

    const rsvps = await RSVP.find({ eventId });
    const rows = buildReportRows(rsvps);

    let buffer: Buffer;
    let contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    let extension = "xlsx";

    if (type === "csv") {
      const worksheet = xlsx.utils.json_to_sheet(rows);
      const csv = xlsx.utils.sheet_to_csv(worksheet);
      buffer = Buffer.from(csv, "utf8");
      contentType = "text/csv";
      extension = "csv";
    } else if (type === "pdf") {
      buffer = await buildPdfBuffer(event, rows);
      contentType = "application/pdf";
      extension = "pdf";
    } else {
      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(rows);
      xlsx.utils.book_append_sheet(workbook, worksheet, "RSVP Report");
      buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extension = "xlsx";
    }

    const key = `reports/${eventId}/${Date.now()}_${uuidv4()}.${extension}`;
    const fileUrl = await uploadToS3(buffer, key, contentType);

    const report = await Report.create({
      eventId,
      type,
      fileUrl,
      status: "ready",
      shareToken: uuidv4(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return res.status(201).json({
      message: "Report generated",
      reportId: report._id,
      fileUrl,
      shareToken: report.shareToken,
      expiresAt: report.expiresAt,
    });
  } catch (error: any) {
    console.error("generateRsvpReport error", error);
    return res
      .status(500)
      .json({ message: "Failed to generate report", error: error.message });
  }
};

export const listRsvpReports = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const reports = await Report.find({ eventId }).sort({ createdAt: -1 });
    return res.json({ reports });
  } catch (error: any) {
    console.error("listRsvpReports error", error);
    return res.status(500).json({ message: "Failed to load reports" });
  }
};

export const downloadReport = async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }
    return res.redirect(report.fileUrl);
  } catch (error: any) {
    console.error("downloadReport error", error);
    return res.status(500).json({ message: "Failed to download report" });
  }
};

export const getShareableReport = async (req: Request, res: Response) => {
  try {
    const { eventId, token } = req.params;
    const report = await Report.findOne({ eventId, shareToken: token });
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }
    if (report.expiresAt && report.expiresAt < new Date()) {
      return res.status(410).json({ message: "Report link expired" });
    }
    return res.json({
      reportId: report._id,
      fileUrl: report.fileUrl,
      type: report.type,
      expiresAt: report.expiresAt,
    });
  } catch (error: any) {
    console.error("getShareableReport error", error);
    return res.status(500).json({ message: "Failed to load shareable report" });
  }
};
