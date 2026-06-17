import mongoose from "mongoose";

const whatsAppInboundMessageSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: false,
      default: null,
      index: true,
    },
    guestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Guest",
      required: false,
      default: null,
      index: true,
    },
    rsvpId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RSVP",
      required: false,
      default: null,
      index: true,
    },
    provider: {
      type: String,
      enum: ["twilio", "meta"],
      required: true,
    },
    from: {
      type: String,
      required: true,
      index: true,
    },
    to: {
      type: String,
      required: false,
      default: null,
    },
    body: {
      type: String,
      required: false,
      default: "",
    },
    profileName: {
      type: String,
      required: false,
      default: null,
    },
    waId: {
      type: String,
      required: false,
      default: null,
    },
    providerMessageId: {
      type: String,
      required: false,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["received", "handled"],
      default: "received",
      index: true,
    },
    followUpRequired: {
      type: Boolean,
      default: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

whatsAppInboundMessageSchema.index(
  { provider: 1, providerMessageId: 1 },
  {
    unique: true,
    sparse: true,
  },
);

export const WhatsAppInboundMessage = mongoose.model(
  "WhatsAppInboundMessage",
  whatsAppInboundMessageSchema,
);
