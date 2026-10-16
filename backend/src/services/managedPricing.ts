import { isOpenRouter } from "./openrouter.js";
import { assertProviderBudget } from "./platformControl.js";
import { createHash } from "node:crypto";
import { randomToken } from "../utils/crypto.js";
import { ApprovedQuote, ProviderControl } from "../models/Admin.js";
import { GenerationPriceRule } from "../models/GenerationPriceRule.js";
export function fingerprint(value: any): string { const clean = (v: any): any => Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter(k => k !== "approvedCredits").sort().map(k => [k, clean(v[k])])) : v; return createHash("sha256").update(JSON.stringify(clean(value))).digest("hex"); }
export async function managedPrice(feature: string, provider: string, settings: any, fallback: number) {
  const unit = feature === "text_to_image" ? `image:${settings.resolution}` : feature === "image_to_video" ? `second:${settings.quality}` : "character";
  const quantity = feature === "text_to_image" ? settings.numberOfImages : feature === "image_to_video" ? settings.quantity * settings.durationSeconds : settings.mode === "multi" ? settings.speakers.map((s: any) => s.text).join(" ").length : settings.text.length;
  if (isOpenRouter(settings.model)) { const quote = await (await import("./creditPricingEngine.js")).quoteAutomaticCredits({ feature, provider, model: settings.model, unit, quantity, settings }); await assertProviderBudget(settings.model, quote.estimatedCostUsd); return quote; }
  const rule = await GenerationPriceRule.findOne({ feature, provider, model: settings.model, unit }).sort({ createdAt: -1 });
  if (isOpenRouter(settings.model) && (!rule || !(rule.providerCostUsd > 0))) throw new Error("Configure verified OpenRouter pricing in Admin before quoting this model. Existing direct models remain available.");
  if (rule && !rule.active) throw new Error("Pricing for this model is disabled.");
  const control = await ProviderControl.findOne({ model: settings.model }); if (control && !control.enabled) throw new Error("This model is disabled.");
  const estimate = rule && rule.providerCostUsd > 0 ? rule.providerCostUsd * quantity : null;
  if (control && (estimate === null || estimate > control.maxJobCostUsd)) throw new Error("Provider cost is unknown or exceeds the maximum permitted job spending.");
  await assertProviderBudget(settings.model, estimate);
  return { credits: rule ? Math.ceil(rule.creditsPerUnit * quantity) : fallback, feature, provider, model: settings.model, unit, quantity, estimatedCostUsd: estimate, ruleId: rule?._id, expiresAt: new Date(Date.now() + 600000) };
}
export async function rememberQuote(userId: any, settings: any, quote: any) { await ApprovedQuote.create({ userId, token: randomToken(24), fingerprint: fingerprint(settings), quote, expiresAt: new Date(Date.now() + 600000) }); return quote; }
export async function approvedTerms(userId: any, settings: any, credits: number, current: () => Promise<any>) {
  const existing = await ApprovedQuote.findOne({ userId, fingerprint: fingerprint(settings), "quote.credits": credits, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }); return existing?.quote || current();
}
