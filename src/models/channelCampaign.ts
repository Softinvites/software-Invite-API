import { Schema, model, Document, Types } from "mongoose";

export interface ChannelCampaignDocument extends Document {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  campaignName: string;
  channel: "email" | "whatsapp" | "bulkSms";
  messageSequenceId?: Types.ObjectId;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  respondedCount: number;
  cost?: number;
  sentAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelCampaignSchema = new Schema<ChannelCampaignDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    campaignName: { type: String, required: true },
    channel: {
      type: String,
      enum: ["email", "whatsapp", "bulkSms"],
      default: "email",
    },
    messageSequenceId: { type: Schema.Types.ObjectId, default: null },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    openedCount: { type: Number, default: 0 },
    clickedCount: { type: Number, default: 0 },
    respondedCount: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ChannelCampaignSchema.index({ eventId: 1, channel: 1 });

export const ChannelCampaign = model<ChannelCampaignDocument>(
  "ChannelCampaign",
  ChannelCampaignSchema,
);
