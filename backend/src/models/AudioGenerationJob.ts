import { Schema, model } from "mongoose";

const audioGenerationJobSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "AIProject" },
  sceneId: String,
  characterName: String,
  reservationId: { type: Schema.Types.ObjectId, ref: "CreditReservation" },
  text: String,
  provider: { type: String, default: "gemini" },
  model: { type: String, required: true },
  voiceId: { type: String, required: true },
  language: { type: String, default: "English" },
  style: String,
  mode: { type: String, enum: ["single", "multi"], default: "single" },
  speakers: [{ speaker: String, voice: String, text: String, style: String }],
  status: { type: String, enum: ["queued", "processing", "completed", "failed"], default: "queued", index: true },
  approvedCredits: Number,
  durationSeconds: Number,
  outputMetadata: { type: Schema.Types.Mixed, default: {} },
  providerUsage: { type: Schema.Types.Mixed, default: {} },
  attempts: { type: Number, default: 0 },
  error: String,
  completedAt: Date
}, { timestamps: true });

export const AudioGenerationJob = model("AudioGenerationJob", audioGenerationJobSchema);
