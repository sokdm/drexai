import { Schema, model } from "mongoose";

const nicheSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true },
  description: String,
  category: String,
  audience: String,
  contentStyle: String,
  language: { type: String, default: "English" },
  preferredVideoDuration: String,
  visualStyle: String,
  storytellingStyle: String,
  savedChannelReferences: [{ type: Schema.Types.Mixed }],
  preferredVoices: [String],
  preferences: { type: Schema.Types.Mixed, default: {} },
  selected: { type: Boolean, default: false }
}, { timestamps: true });

export const Niche = model("Niche", nicheSchema);
