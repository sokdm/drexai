import { Schema, model } from "mongoose";

const youtubeCacheSchema = new Schema({
  key: { type: String, required: true, unique: true },
  data: { type: Schema.Types.Mixed, required: true },
  quotaUnits: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

export const YouTubeCache = model("YouTubeCache", youtubeCacheSchema);
