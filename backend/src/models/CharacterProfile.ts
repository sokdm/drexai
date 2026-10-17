import { Schema, model } from "mongoose";

const characterProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "AIProject" },
  name: { type: String, required: true },
  appearance: String,
  clothing: String,
  personality: String,
  voicePreference: String,
  referenceImageUrl: String,
  referenceAssetId: { type: Schema.Types.ObjectId, ref: "MediaAsset" }
}, { timestamps: true });

export const CharacterProfile = model("CharacterProfile", characterProfileSchema);
