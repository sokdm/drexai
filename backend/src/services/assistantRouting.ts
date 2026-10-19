import {safeTextModel} from "./modelPolicy.js";
import { defaultModel, assertProviderBudget } from "./platformControl.js";
import { routerCatalog } from "./openrouter.js";
import { verifiedFreeText } from "./freeAiLimits.js";
import { getPricingPolicy } from "./creditPricingEngine.js";
import { env } from "../config/env.js";

export async function assistantModel(feature: string, mode = "configured", userId?: string, requests = 1) {
 if(mode === "auto") {
  const {freeAiAvailable}=await import("./freeAiLimits.js");
  if(userId && await freeAiAvailable(userId,requests))try{return await assistantModel(feature,"free");}catch{}
  return safeTextModel("openrouter/"+env.OPENROUTER_TEXT_FALLBACK_MODEL);
 }
 const configured = await defaultModel(feature, await defaultModel("text", "openrouter/" + env.OPENROUTER_TEXT_MODEL));
 if (mode === "paid") return safeTextModel("openrouter/" + env.OPENROUTER_TEXT_FALLBACK_MODEL);
 if (mode !== "free") return configured;
 const { values } = await getPricingPolicy();
 const candidates = (await routerCatalog("text")).filter((r: any) => verifiedFreeText(r) && r.architecture?.output_modalities?.includes("text") && r.supported_parameters?.includes("response_format") && r.supported_parameters?.includes("max_tokens") && r.context_length >= values.maxInputTokens + values.maxOutputTokens);
 candidates.sort((a: any,b: any) => Number("openrouter/" + b.id === configured) - Number("openrouter/" + a.id === configured));
 for (const record of candidates) { const candidate = "openrouter/" + record.id; try { await assertProviderBudget(candidate,0); return candidate; } catch {} }
 throw new Error("No compatible verified free model is available. Select credit-priced continuation to review a paid quote; no paid operation was submitted.");
}
