import { env } from "../config/env.js";
import { routerCatalog, routerId, verifiedRouterModel } from "./openrouter.js";
import { imageModels } from "./imageGeneration.js";
import { videoModels } from "./videoGeneration.js";
import { ttsModels } from "./textToSpeech.js";

const cache = new Map<string, { expires: number; data: any }>();
export async function routerPricing(id: string, kind: string) {
  const key = kind + ":" + id, cached = cache.get(key); if (cached && cached.expires > Date.now()) return cached.data;
  const remote = routerId(id);
  const record = await verifiedRouterModel(id, kind as any);
  let pricing = record.pricing || record.pricing_skus;
  if (kind === "image") {
    const response = await fetch(`https://openrouter.ai/api/v1/images/models/${remote}/endpoints`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("OpenRouter image endpoint pricing is unavailable");
    const data = await response.json(); pricing = data.endpoints?.map((e: any) => ({ provider: e.provider_name, pricing: e.pricing, parameters: e.supported_parameters }));
  }
  if (!pricing || Array.isArray(pricing) && (!pricing.length || !pricing.some((entry: any) => entry.pricing?.length))) throw new Error("No published OpenRouter pricing is available for this model");
  const data = { pricing, capabilities: record.supported_parameters || { durations: record.supported_durations, resolutions: record.supported_resolutions, aspectRatios: record.supported_aspect_ratios }, verifiedAt: new Date().toISOString(), source: "OpenRouter model discovery API", note: "Published provider rates, not incurred expense. Credit prices remain separately configured." };
  cache.set(key, { expires: Date.now() + 300000, data }); return data;
}
export async function routerAdminCatalog() {
  const result: any[] = [];
  const kinds = ["text", "image", "video", "voice"] as const;
  const failures: string[] = [];
  await Promise.all(kinds.map(async kind => {
    try {
      const records = await routerCatalog(kind);
      const allowed = kind === "image" ? imageModels : kind === "video" ? videoModels : kind === "voice" ? ttsModels : null;
      for (const record of records) {
        const id = "openrouter/" + record.id;
        if (allowed && !allowed.some(m => m.id === id)) continue;
        if (kind === "text" && (!record.architecture?.output_modalities?.includes("text") || !record.supported_parameters?.includes("response_format"))) continue;
        if (kind === "voice" && !record.architecture?.output_modalities?.includes("speech")) continue;
        result.push({ provider: "openrouter", model: id, configured: !!env.OPENROUTER_API_KEY, type: kind, pricingStatus: "Published rates available through View pricing", verifiedAt: new Date().toISOString() });
      }
    } catch { failures.push(kind); }
  }));
  return { catalog: result, unavailable: failures, note: failures.length ? "Discovery temporarily unavailable for: " + failures.join(", ") + ". Direct integrations were preserved." : "Catalog verified against OpenRouter. Account-specific paid generation is not yet tested." };
}
