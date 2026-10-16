import { Schema, model } from "mongoose";

const generationPriceRuleSchema = new Schema({
  feature: { type: String, required: true, enum: ["publishing_optimization", "ai_research_chat", "ai_channel_analysis", "text_to_image", "image_to_video", "voice_generation", "story_generation", "ai_studio_production", "final_rendering"] },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  unit: { type: String, required: true },
  providerCostUsd: { type: Number, required: true, default: 0 },
  desiredMarginPct: { type: Number, required: true, default: 50 },
  creditsPerUnit: { type: Number, required: true, default: 0 },
  notes: String,
  active: { type: Boolean, default: false }
}, { timestamps: true });

export const GenerationPriceRule = model("GenerationPriceRule", generationPriceRuleSchema);
