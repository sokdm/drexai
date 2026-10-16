import { Schema, model } from "mongoose";

const mediaAssetSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "AIProject" },
  jobId: { type: Schema.Types.ObjectId, ref: "ImageGenerationJob", required: function(this: any) { return this.provider !== "upload"; }, index: true },
  type: { type: String, enum: ["image", "video", "audio"], default: "image" },
  prompt: String,
  provider: String,
  model: String,
  storageProvider: { type: String, default: "r2" },
  bucket: String,
  key: { type: String, required: true },
  contentType: { type: String, default: "image/png" },
  sizeBytes: Number,
  width: Number,
  height: Number,
  durationSeconds: Number,
  sceneId: String,
  productionId: { type: Schema.Types.ObjectId, index: true },
  productionStepKey: String,
  characterName: String,
  voiceId: String,
  url: String,
  deletedAt: Date,
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

mediaAssetSchema.index({ productionId: 1, productionStepKey: 1 }, { unique: true, partialFilterExpression: { productionId: { $type: "objectId" }, productionStepKey: { $type: "string" } } });
export const MediaAsset = model("MediaAsset", mediaAssetSchema);
