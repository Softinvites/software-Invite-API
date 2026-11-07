import { Schema, model, Document, Types } from "mongoose";

export interface ContactMessageDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  eventType: string;
  eventDate?: string;
  location?: string;
  guestCount?: string;
  services: string[];
  message?: string;
  /**
   * System-managed, never set by hand:
   *   new       → on submission
   *   read      → the first time an admin opens it
   *   responded → as soon as a reply is sent from the dashboard
   */
  status: "new" | "read" | "responded" | "archived";
  source: string;
  adminNotes?: string;
  replies: Array<{
    body: string;
    subject: string;
    sentAt: Date;
    sentBy?: string;
    delivered: boolean;
    error?: string | null;
  }>;
  lastRepliedAt?: Date | null;
  /** Whether the notification email to the admin inbox went out. */
  notified: boolean;
  notificationError?: string | null;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContactMessageSchema = new Schema<ContactMessageDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    phone: { type: String, trim: true, maxlength: 40 },
    eventType: { type: String, required: true, trim: true, maxlength: 200 },
    eventDate: { type: String, trim: true, maxlength: 40 },
    location: { type: String, trim: true, maxlength: 200 },
    guestCount: { type: String, trim: true, maxlength: 40 },
    services: { type: [String], default: [] },
    message: { type: String, trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ["new", "read", "responded", "archived"],
      default: "new",
      index: true,
    },
    source: { type: String, default: "website" },
    adminNotes: { type: String, trim: true, maxlength: 5000 },
    replies: {
      type: [
        {
          _id: false,
          body: { type: String, required: true, maxlength: 10000 },
          subject: { type: String, required: true, maxlength: 300 },
          sentAt: { type: Date, default: Date.now },
          sentBy: { type: String },
          delivered: { type: Boolean, default: false },
          error: { type: String, default: null },
        },
      ],
      default: [],
    },
    lastRepliedAt: { type: Date, default: null },
    notified: { type: Boolean, default: false },
    notificationError: { type: String, default: null },
    ipAddress: { type: String },
    userAgent: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

// The admin inbox is sorted newest-first and filtered by status.
ContactMessageSchema.index({ createdAt: -1 });
ContactMessageSchema.index({ status: 1, createdAt: -1 });

export const ContactMessage = model<ContactMessageDocument>(
  "ContactMessage",
  ContactMessageSchema,
);
