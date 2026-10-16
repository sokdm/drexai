import { Schema, model } from "mongoose";

const savedItemSchema = new Schema({
  itemType: { type: String, enum: ["video", "channel"], required: true },
  youtubeId: { type: String, required: true },
  title: String,
  channelTitle: String,
  thumbnail: String,
  url: String,
  metadata: { type: Schema.Types.Mixed, default: {} },
  savedAt: { type: Date, default: Date.now }
}, { _id: true });

const researchCollectionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, default: "Saved Research" },
  items: [savedItemSchema]
}, { timestamps: true });

export const ResearchCollection = model("ResearchCollection", researchCollectionSchema);
