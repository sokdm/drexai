import { Schema, model } from "mongoose";

const imageGenerationJobSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "AIProject" },
  reservationId: { type: Schema.Types.ObjectId, ref: "CreditReservation" },
  prompt: { type: String, required: true },
  stylePreset: String,
  provider: { type: String, default: "gemini" },
  model: { type: String, required: true },
  aspectRatio: String,
  resolution: String,
  numberOfImages: { type: Number, default: 1 },
  characterReferenceIds: [String],
  sourceAssetIds: [String],
  tool: String,
  background: String,
  requestId: String,
  status: { type: String, enum: ["quoted", "queued", "processing", "completed", "failed", "retrying"], default: "quoted", index: true },
  dispatchMode: { type: String, enum: ["redis", "mongo"], default: "redis", index: true },
  approvedCredits: Number,
  outputMetadata: { type: Schema.Types.Mixed, default: {} },
  providerUsage: { type: Schema.Types.Mixed, default: {} },
  attempts: { type: Number, default: 0 },
  error: String,
  completedAt: Date
}, { timestamps: true });

imageGenerationJobSchema.index({ userId: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
export const ImageGenerationJob = model("ImageGenerationJob", imageGenerationJobSchema);
