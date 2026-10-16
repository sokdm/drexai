import { Schema, model } from "mongoose";

const videoGenerationJobSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "AIProject" },
  sourceImageAssetId: { type: Schema.Types.ObjectId, ref: "MediaAsset" },
  sourceImageUrl: String,
  reservationId: { type: Schema.Types.ObjectId, ref: "CreditReservation" },
  sceneId: String,
  dialogueLines: { type: [{ speaker: String, text: String, language: String, accent: String, emotion: String, delivery: String }], default: undefined },
  dialogueLanguage: String, preferredAccent: String, emotionAndDelivery: String, characterActions: String,
  characterDescriptions: String, cameraDirection: String, cameraPosition: String, cameraMovements: String,
  environmentalSounds: String, soundEffects: String, backgroundAmbience: String, nativeAudio: Boolean,
  motionPrompt: { type: String, required: true },
  provider: { type: String, default: "google-veo" },
  model: { type: String, required: true },
  aspectRatio: String,
  durationSeconds: Number,
  quality: String,
  quantity: { type: Number, default: 1 },
  providerJobId: String,
  progress: { type: Number, default: 0 },
  status: { type: String, enum: ["quoted", "queued", "processing", "completed", "failed", "retrying"], default: "quoted", index: true },
  approvedCredits: Number,
  outputMetadata: { type: Schema.Types.Mixed, default: {} },
  providerUsage: { type: Schema.Types.Mixed, default: {} },
  attempts: { type: Number, default: 0 },
  error: String,
  completedAt: Date
}, { timestamps: true });

export const VideoGenerationJob = model("VideoGenerationJob", videoGenerationJobSchema);
