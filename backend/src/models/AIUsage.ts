import { Schema, model } from "mongoose";

const aiUsageSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, default: "gemini" },
  model: { type: String, required: true },
  feature: { type: String, required: true },
  inputTokens: Number,
  outputTokens: Number,
  creditsQuoted: { type: Number, default: 0 },
  creditsCharged: { type: Number, default: 0 },
  status: { type: String, enum: ["quoted", "completed", "failed"], default: "completed" },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

export const AIUsage = model("AIUsage", aiUsageSchema);
