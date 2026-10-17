import { Decimal } from "decimal.js";
import { z } from "zod";
import { PricingPolicy, PricingOverride } from "../models/Finance.js";
import { CreditPackage } from "../models/CreditPackage.js";
import { routerPricing } from "./openrouterAdmin.js";
import { verifiedRouterModel, checkCapability } from "./openrouter.js";
import { env } from "../config/env.js";

const pct = z.number().min(0).max(95), usd = z.number().min(0).max(10000);
export const pricingPolicySchema = z.object({
  markup: z.number().min(1).max(100), marginPct: pct, minimumCredits: z.number().int().min(1).max(10000),
  imageMinimumCredits: z.number().int().min(1).max(10000), paymentFeePct: pct, providerFeePct: pct,
  contingencyPct: pct, renderingUsd: usd, storageUsd: usd, otherUsd: usd,
  roundingCredits: z.number().int().min(1).max(100), maxJobUsd: z.number().positive().max(10000),
  userDailyUsd: z.number().positive().max(100000), globalDailyUsd: z.number().positive().max(1000000),
  maxInputTokens: z.number().int().min(100).max(200000), maxOutputTokens: z.number().int().min(100).max(32000),
  lowBalanceUsd: usd, criticalBalanceUsd: usd, maxBalanceAgeMinutes: z.number().int().min(1).max(60),
  monthlyInfrastructureUsd: usd, requireBalanceCheck: z.boolean(),
  featurePolicies: z.record(z.object({ markup: z.number().min(1).max(100).optional(), marginPct: pct.optional(), minimumCredits: z.number().int().min(1).max(10000).optional() })).default({})
});
export const defaultPricingPolicy = { markup: 3, marginPct: 0, minimumCredits: 1, imageMinimumCredits: 1, paymentFeePct: 3, providerFeePct: 0, contingencyPct: 0, renderingUsd: 0, storageUsd: 0, otherUsd: 0, roundingCredits: 1, maxJobUsd: 20, userDailyUsd: 50, globalDailyUsd: 200, maxInputTokens: 20000, maxOutputTokens: 12000, lowBalanceUsd: 2, criticalBalanceUsd: 1, maxBalanceAgeMinutes: 5, monthlyInfrastructureUsd: 0, requireBalanceCheck: false, featurePolicies: {} };
export async function getPricingPolicy() {
  const row = await PricingPolicy.findById("global").lean();
  return { revision: row?.revision || 1, values: pricingPolicySchema.parse({ ...defaultPricingPolicy, ...(row?.values || {}) }) };
}
export function calculateCreditPrice(cost: string | number, packages: { amount: number; credits: number; currency?: string; active?: boolean }[], policy: any, quantity = 1, image = false) {
  const rates = packages.filter(p => p.active !== false && (!p.currency || p.currency === "USD") && p.credits > 0 && p.amount > 0).map(p => new Decimal(p.amount).div(p.credits));
  if (!rates.length) throw new Error("An active USD credit package is required for pricing");
  const creditUsd = Decimal.min(...rates), netCreditUsd = creditUsd.mul(new Decimal(1).minus(new Decimal(policy.paymentFeePct).div(100)));
  const providerUsd = new Decimal(cost); if (!providerUsd.isFinite() || providerUsd.lte(0)) throw new Error("Provider cost must have a positive verified estimate");
  const operating = new Decimal(policy.renderingUsd).plus(policy.storageUsd).plus(policy.otherUsd);
  const protectedCost = providerUsd.mul(new Decimal(1).plus(new Decimal(policy.providerFeePct).div(100))).plus(operating).mul(new Decimal(1).plus(new Decimal(policy.contingencyPct).div(100)));
  const targetNet = Decimal.max(protectedCost.mul(policy.markup), protectedCost.div(new Decimal(1).minus(new Decimal(policy.marginPct).div(100))));
  const minimum = image ? new Decimal(policy.imageMinimumCredits).mul(quantity) : new Decimal(policy.minimumCredits);
  const credits = Decimal.max(targetNet.div(netCreditUsd), minimum).div(policy.roundingCredits).ceil().mul(policy.roundingCredits);
  if ((!credits.isInteger() || credits.gt(Number.MAX_SAFE_INTEGER)) || credits.gt(1000000)) throw new Error("Price exceeds the configured safety limit");
  return { credits: credits.toNumber(), providerUsd: providerUsd.toString(), protectedCostUsd: protectedCost.toString(), creditUsd: creditUsd.toString(), netCreditUsd: netCreditUsd.toString(), grossCreditValueUsd: credits.mul(creditUsd).toString(), estimatedMarginPct: new Decimal(1).minus(protectedCost.div(credits.mul(netCreditUsd))).mul(100).toFixed(4) };
}
export async function estimateRouterCost(input: any, policy: any) {
  const kind = input.feature === "text_to_image" ? "image" : input.feature === "image_to_video" ? "video" : input.feature === "voice_generation" ? "voice" : "text";
  const settings = input.settings || {}, quantity = Number(input.quantity ?? 1);
  const override = await PricingOverride.findOne({ feature: input.feature, model: input.model, unit: input.unit || "request", expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
  if (override) {
    for (const [key, expected] of Object.entries(override.settings || {})) if (settings[key] !== expected) throw new Error("Verified pricing override does not cover these settings");
    return { cost: new Decimal(override.costUsd!).mul(quantity), source: "verified-admin-override", verifiedAt: override.verifiedAt, sourceUrl: override.verificationUrl, limits: { maxInputTokens: policy.maxInputTokens, maxOutputTokens: policy.maxOutputTokens } };
  }
  if (input.feature === "full_video_transcription") throw new Error("Add a verified per-minute full_video_transcription pricing override for a timestamp-capable OpenRouter STT model before enabling full transcription.");
  const published = await routerPricing(input.model, kind), limits = { maxInputTokens: policy.maxInputTokens, maxOutputTokens: policy.maxOutputTokens };
  if (kind === "text") {
    const boundedMotionImage = input.feature === "ai_motion_prompt" && input.model === "openrouter/openai/gpt-4.1-mini" && settings.boundedImage === true;
    if (["short_clip_analysis"].includes(input.feature) || settings.multimodal && !boundedMotionImage) throw new Error("Verify a bounded multimodal processing cost before enabling automatic pricing for this feature");
    const record = await verifiedRouterModel(input.model, "text");
    if (record.context_length && limits.maxInputTokens + limits.maxOutputTokens > record.context_length) throw new Error("Pricing token limits exceed this model's context window; lower them or verify an override");
    const rates = published.pricing;
    // This adapter sends text only, with no search tools. Media and search rates
    // cannot apply to this path; multimodal work requires a verified bound above.
    const unknown = Object.entries(rates).filter(([key, value]) => !["prompt", "completion", "request", "internal_reasoning", "input_cache_read", "input_cache_write", "image", "audio", "input_audio_cache", "web_search"].includes(key) && new Decimal(String(value || 0)).gt(0));
    if (unknown.length || rates.prompt === undefined || rates.completion === undefined) throw new Error("This model's variable charges require a verified pricing override");
    const inputRate = Decimal.max(rates.prompt, rates.input_cache_read || 0).plus(rates.input_cache_write || 0);
    const outputRate = Decimal.max(rates.completion, rates.internal_reasoning || 0);
    return { cost: inputRate.mul(limits.maxInputTokens).plus(outputRate.mul(limits.maxOutputTokens)).plus(rates.request || 0).mul(quantity), source: published.source, verifiedAt: published.verifiedAt, limits: { ...limits, maxPrice: { prompt: inputRate.mul(1000000).toNumber(), completion: outputRate.mul(1000000).toNumber(), request: Number(rates.request || 0) } } };
  }
  if (kind === "image") {
    const costs: Decimal[] = [];
    for (const endpoint of published.pricing as any[]) {
      const lines = endpoint.pricing || [], resolution = settings.resolution || String(input.unit || "image:1K").split(":")[1];
      const relevant = lines.filter((line: any) => !line.variant || String(line.variant).toUpperCase() === resolution.toUpperCase());
      if (!relevant.length || relevant.some((line: any) => line.unit !== "image" || !["output_image", "input_image", "input_reference"].includes(line.billable))) throw new Error("Image token/megapixel pricing requires a verified bounded override");
      if (!relevant.some((line: any) => line.billable === "output_image")) throw new Error("No verified output-image rate for this resolution");
      let cost = new Decimal(0); for (const line of relevant) cost = cost.plus(new Decimal(line.cost_usd).mul(line.billable === "output_image" ? 1 : settings.characterReferenceIds?.length || settings.referenceImages?.length || 0));
      costs.push(cost);
    }
    return { cost: Decimal.max(...costs).mul(quantity), source: published.source, verifiedAt: published.verifiedAt, limits };
  }
  // Video SKUs vary by provider. Never use the zero token prices from the general models endpoint.
  if (kind === "video") {
    const quality = String(settings.quality || String(input.unit).split(":")[1] || "720p").toLowerCase(), rates = published.pricing;
    const key = input.model === "openrouter/alibaba/wan-3.0" ? `duration_seconds_${quality}` : quality === "4k" ? "duration_seconds_with_audio_4k" : "duration_seconds_with_audio";
    if (rates[key] === undefined) throw new Error("Verify the selected resolution and native-audio video pricing before use");
    return { cost: new Decimal(rates[key]).mul(quantity), source: published.source, verifiedAt: published.verifiedAt, limits };
  }
  throw new Error("Speech output token pricing cannot be safely converted to characters without a verified cost bound. Add an expiring verified override.");
}
export async function quoteAutomaticCredits(input: any) {
  const policy = await getPricingPolicy(), values = { ...policy.values, ...(policy.values.featurePolicies[input.feature] || {}) };
  let estimate;
  try { estimate = await estimateRouterCost(input, values); }
  catch (error: any) {
    if (input.feature !== "text_to_image" || !input.model.startsWith("openrouter/google/") || !/token\/megapixel/.test(error.message)) throw error;
    const model = "openrouter/black-forest-labs/flux-3-image-klein", record = await verifiedRouterModel(model, "image");
    checkCapability(record, "resolution", input.settings?.resolution || input.unit.split(":")[1]); checkCapability(record, "aspect_ratio", input.settings?.aspectRatio || "16:9");
    if (input.settings?.characterReferenceIds?.length) checkCapability(record, "input_references", input.settings.characterReferenceIds.length);
    input = { ...input, requestedModel: input.model, model };
    estimate = await estimateRouterCost(input, values);
  }
  const requestLimits: any = { ...estimate.limits }, candidates: any[] = [];
  if (!["text_to_image", "image_to_video", "voice_generation", "short_clip_analysis", "ai_motion_prompt", "full_video_transcription"].includes(input.feature)) {
    const model = "openrouter/" + env.OPENROUTER_TEXT_FALLBACK_MODEL;
    if (model !== input.model) try {
      const record = await verifiedRouterModel(model, "text");
      if (record.supported_parameters?.includes("max_tokens") && record.supported_parameters.includes("response_format")) {
        const alternative = await estimateRouterCost({ ...input, model }, values);
        await (await import("./platformControl.js")).assertProviderBudget(model, alternative.cost.toNumber());
        candidates.push({ model, maxPrice: (alternative.limits as any).maxPrice }); estimate.cost = estimate.cost.plus(alternative.cost);
      }
    } catch { /* Unverified or disabled fallbacks are never included in approved terms. */ }
  }
  if (candidates.length) requestLimits.fallbacks = candidates;
  requestLimits.approvedCostUsd = estimate.cost.toNumber();
  if (estimate.cost.gt(values.maxJobUsd)) throw new Error("Estimated provider cost exceeds the maximum per-job spending limit");
  const packages = await CreditPackage.find({ active: true, currency: "USD" }).lean();
  const calculation = calculateCreditPrice(estimate.cost.toString(), packages, values, Number(input.quantity || 1), input.feature === "text_to_image");
  return { allowed: true, ...calculation, feature: input.feature, provider: "openrouter", model: input.model, requestedModel: input.requestedModel, quantity: input.quantity || 1, unit: input.unit || "request", estimatedCostUsd: estimate.cost.toNumber(), pricingVersion: policy.revision, pricingSource: estimate.source, pricingVerifiedAt: estimate.verifiedAt, requestLimits, assumptions: values, expiresAt: new Date(Date.now() + 600000) };
}
