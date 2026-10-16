import { providerFor } from "./openrouter.js";
import { GenerationPriceRule } from "../models/GenerationPriceRule.js";
import { createQuote } from "./wallet.js";
import { CreditPackage } from "../models/CreditPackage.js";
import type { StudioStep } from "./studioPlan.js";

export async function priceStudioSteps(steps: StudioStep[]) {
  const missing = new Set<string>();
  for (const step of steps) {
    if (step.reused) { step.credits = 0; continue; }
    const feature = step.kind === "image" ? "text_to_image" : step.kind === "audio" ? "voice_generation" : "image_to_video";
    const provider = providerFor(step.input.model);
    const unit = step.kind === "image" ? `image:${step.input.resolution}` : step.kind === "video" ? `second:${step.input.quality}` : "character";
    const rule = await GenerationPriceRule.findOne({ feature, provider, model: step.input.model, unit, active: true });
    if (!rule || rule.unit !== unit || !(rule.creditsPerUnit > 0) || !(rule.providerCostUsd > 0)) {
      missing.add(`${step.input.model} / ${unit}`); step.credits = 0; continue;
    }
    const quantity = step.kind === "audio" ? step.input.text.length : step.kind === "video" ? step.input.durationSeconds : 1;
    const packages = await CreditPackage.find({ active: true, currency: "USD", credits: { $gt: 0 }, amount: { $gt: 0 } }).lean();
    const revenuePerCredit = Math.min(...packages.map(p => p.amount / p.credits));
    const margin = Number(rule.desiredMarginPct) / 100;
    if (!packages.length || margin < 0 || margin >= 1 || rule.creditsPerUnit * revenuePerCredit * (1 - margin) < rule.providerCostUsd) throw new Error(`Pricing for ${step.input.model} does not cover its configured cost and margin at the cheapest credit package`);
    const quote = await createQuote({ feature, provider, model: step.input.model, quantity, unit, ruleId: rule._id });
    if (!quote.allowed || !Number.isSafeInteger(quote.credits) || quote.credits <= 0) throw new Error("Invalid production price");
    step.credits = quote.credits;
    step.pricing = { ruleId: rule._id, unit, quantity, creditsPerUnit: rule.creditsPerUnit, providerCostUsd: rule.providerCostUsd * quantity, costIsEstimate: true };
  }
  return {
    credits: missing.size ? null : steps.reduce((sum, s) => sum + s.credits, 0),
    missingPricing: [...missing],
    images: steps.filter(s => s.kind === "image" && !s.reused).length,
    audioSegments: steps.filter(s => s.kind === "audio" && !s.reused).length,
    maxClips: steps.filter(s => s.kind === "video" && !s.reused).length,
    maxVideoSeconds: steps.filter(s => s.kind === "video" && !s.reused).reduce((sum, s) => sum + s.input.durationSeconds, 0),
    renderCredits: 0, renderMode: "browser-timeline",
    coverage: "Veo clip pricing includes native dialogue and environmental audio. Only requested off-screen narration adds TTS costs. Dialogue clips remain whole; unused ambient clip credits are released."
  };
}
