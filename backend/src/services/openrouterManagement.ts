import { env } from "../config/env.js";
import { ProviderSnapshot, ProviderActivity, OperationalAlert } from "../models/Finance.js";
import { GatewayUsage } from "./openrouter.js";
import { createHash } from "node:crypto";

export async function adminAlert(key: string, title: string, content: string, severity = "warning") {
  await OperationalAlert.updateOne({ key }, { $set: { title, content, severity, lastOccurredAt: new Date() }, $setOnInsert: { readAt: null }, $inc: { count: 1 } }, { upsert: true });
}
const inFlight = new Map<string, Promise<any>>();
export async function syncProviderRecord(kind: "balance" | "activity" | "key", force = false): Promise<any> {
  const existing = await ProviderSnapshot.findById(kind).lean(), age = Date.now() - new Date(existing?.attemptedAt || 0).getTime();
  if (age < (force ? 30000 : kind === "activity" ? 300000 : 60000)) return existing;
  if (inFlight.has(kind)) return inFlight.get(kind);
  const task = (async () => {
    const token = kind === "key" ? env.OPENROUTER_API_KEY : env.OPENROUTER_MANAGEMENT_KEY;
    const attemptedAt = new Date();
    if (!token) {
      await ProviderSnapshot.updateOne({ _id: kind }, { $set: { attemptedAt, error: kind === "key" ? "Generation API key required" : "Management key required. Add OPENROUTER_MANAGEMENT_KEY privately in Render." } }, { upsert: true });
      return ProviderSnapshot.findById(kind).lean();
    }
    try {
      const endpoint = kind === "balance" ? "credits" : kind === "activity" ? "activity" : "key";
      const response = await fetch("https://openrouter.ai/api/v1/" + endpoint, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`OpenRouter ${response.status === 401 || response.status === 403 ? "authentication/permission error" : response.status === 429 ? "rate limit reached" : "service error"} (${response.status}).`);
      const payload = await response.json(), data = payload.data;
      let values: any;
      if (kind === "balance") {
        if (!Number.isFinite(data?.total_credits) || !Number.isFinite(data?.total_usage) || data.total_credits < 0 || data.total_usage < 0) throw new Error("Invalid provider balance response");
        values = { totalCreditsUsd: data.total_credits, totalUsageUsd: data.total_usage, remainingUsd: data.total_credits - data.total_usage, currency: "USD" };
      } else if (kind === "key") {
        values = Object.fromEntries(["usage", "usage_daily", "usage_weekly", "usage_monthly", "limit", "limit_remaining", "limit_reset", "is_free_tier"].filter(k => data?.[k] !== undefined).map(k => [k, data[k]]));
      } else {
        if (!Array.isArray(data)) throw new Error("Invalid provider activity response");
        for (const row of data) {
          const date = String(row.date || "").slice(0, 10), model = String(row.model || row.model_permaslug || "Unknown"), provider = String(row.provider_name || row.provider || "Unknown");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const identity = createHash("sha256").update(JSON.stringify([date, model, provider, row.endpoint_id ?? "", row.api_key_hash ?? ""])).digest("hex");
          const number = (v: any) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
          await ProviderActivity.updateOne({ identity }, { $set: { date, model, provider, requests: number(row.requests), promptTokens: number(row.prompt_tokens ?? row.tokens_prompt), completionTokens: number(row.completion_tokens ?? row.tokens_completion), costUsd: number(row.usage ?? row.cost) } }, { upsert: true });
        }
        values = { rows: data.length, coverage: "Last 30 completed UTC days from provider; collected records are retained in MongoDB." };
      }
      await ProviderSnapshot.updateOne({ _id: kind }, { $set: { values, syncedAt: attemptedAt, attemptedAt, error: "" } }, { upsert: true });
    } catch (error: any) {
      const message = error.name === "TimeoutError" || error.name === "AbortError" ? "OpenRouter synchronization timed out" : String(error.message).replace(/sk-or-[\w-]+/g, "[redacted]").slice(0, 300);
      await ProviderSnapshot.updateOne({ _id: kind }, { $set: { attemptedAt, error: message } }, { upsert: true });
      await adminAlert("provider-sync:" + kind, "OpenRouter synchronization failed", message);
    }
    return ProviderSnapshot.findById(kind).lean();
  })();
  inFlight.set(kind, task); try { return await task; } finally { inFlight.delete(kind); }
}
export async function providerAccountStatus(refresh = false) {
  const records = await Promise.all((["balance", "key", "activity"] as const).map(kind => syncProviderRecord(kind, refresh)));
  const [balance, key, activity] = records;
  const { getPricingPolicy } = await import("./creditPricingEngine.js"), policy = await getPricingPolicy();
  if (balance?.values && !balance.error && balance.values.remainingUsd < policy.values.lowBalanceUsd) await adminAlert("openrouter-low-balance", "OpenRouter balance is low", `Provider-reported balance: $${balance.values.remainingUsd.toFixed(4)} USD.`, balance.values.remainingUsd < policy.values.criticalBalanceUsd ? "critical" : "warning");
  return { freeAi: await (await import("./freeAiLimits.js")).freeAiStatus(), managementConfigured: !!env.OPENROUTER_MANAGEMENT_KEY, generationConfigured: !!env.OPENROUTER_API_KEY, balance, key, activity, stale: records.some(r => !r?.syncedAt || !!r.error || Date.now() - new Date(r.syncedAt).getTime() > 300000), instructions: "Account balance/activity need OPENROUTER_MANAGEMENT_KEY. Key-level limits use OPENROUTER_API_KEY. Neither key is sent to the browser." };
}
export async function checkProviderAffordability(estimate: number) {
  const { getPricingPolicy } = await import("./creditPricingEngine.js"), policy = await getPricingPolicy();
  if (!Number.isFinite(estimate) || estimate < 0 || estimate > policy.values.maxJobUsd) throw Object.assign(new Error("This operation exceeds the generation spending limit. Choose fewer clips or a lower-cost model/quality, then refresh the quote."),{code:"APPROVAL_STATE",statusCode:409});
  const [balance, key] = await Promise.all([syncProviderRecord("balance"), syncProviderRecord("key")]);
  const fresh = (row: any) => row?.syncedAt && !row.error && Date.now() - new Date(row.syncedAt).getTime() < policy.values.maxBalanceAgeMinutes * 60000;
  if (policy.values.requireBalanceCheck && !fresh(balance)) throw Object.assign(new Error("The generation service could not verify its available capacity. Please retry shortly; no new credits were reserved."),{code:"APPROVAL_STATE",statusCode:503});
  if (fresh(balance) && balance.values.remainingUsd < estimate || fresh(key) && key.values.limit_remaining != null && key.values.limit_remaining < estimate) {
    await adminAlert("openrouter-insufficient", "OpenRouter funds are insufficient", "A new generation was blocked before submission. Review balance and key-level limits.", "critical");
    throw Object.assign(new Error("The generation service currently has insufficient capacity for this operation. Choose a smaller operation or retry after support restores capacity. No new credits were reserved."),{code:"APPROVAL_STATE",statusCode:503});
  }
}
export async function verifyGenerationCost(generationId: string) {
  if (!/^[\w-]{5,150}$/.test(generationId)) throw new Error("Invalid generation ID");
  if (!env.OPENROUTER_API_KEY) throw new Error("Generation API key required");
  const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`, { headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`OpenRouter generation lookup failed (${response.status})`);
  const { data } = await response.json();
  if (!Number.isFinite(data?.total_cost)) throw new Error("Provider has not reported a final cost for this generation");
  await GatewayUsage.updateMany({ requestId: generationId }, { $set: { costUsd: data.total_cost, "usage.verifiedCost": true, "usage.provider": data.provider_name, "usage.nativeInputTokens": data.native_tokens_prompt, "usage.nativeOutputTokens": data.native_tokens_completion } });
  return { generationId, costUsd: data.total_cost, provider: data.provider_name, inputTokens: data.native_tokens_prompt, outputTokens: data.native_tokens_completion };
}
export function startProviderMonitor() {
  if (!env.OPENROUTER_MANAGEMENT_KEY && !env.OPENROUTER_API_KEY) return;
  const timer = setInterval(() => void providerAccountStatus().catch(() => {}), 300000); timer.unref();
}
