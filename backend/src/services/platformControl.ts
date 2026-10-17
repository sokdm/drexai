import { ModelPresentation } from "../models/Finance.js";
import { AsyncLocalStorage } from "node:async_hooks";
const executionContext = new AsyncLocalStorage<Set<string>>();
import { providerFor, isOpenRouter, GatewayBinding, routerCatalog } from "./openrouter.js";
import { env } from "../config/env.js";
import mongoose from "mongoose";
import { PlatformControl, ProviderControl, ProviderLease, ProviderDaily } from "../models/Admin.js";
import { User } from "../models/User.js";
import { adminIdentity } from "./adminSecurity.js";
export const featurePaths: Record<string, string> = { creative: "studio", youtube: "research", ai: "assistant", images: "images", videos: "videos", voice: "voice", studio: "studio", publishing: "publishing" };
export async function platformGate(req: any, res: any, next: any) {
  try {
    if (req.path.startsWith("/admin") || req.path.startsWith("/health") || req.path === "/platform-status") return next();
    const settings = await PlatformControl.findById("platform").lean(); if (!settings) return next();
    const privileged = await adminIdentity(req); if (privileged) return next();
    if (settings.maintenance) return res.status(503).json({ error: settings.message, maintenance: true });
    const key = req.path.split("/")[1], feature = featurePaths[key];
    const specific = key === "ai" && /\/(script|projects)/.test(req.path) ? "scripts" : key === "publishing" && /thumbnail/.test(req.path) ? "thumbnails" : key === "creative" && req.body?.kind === "shorts" ? "shorts" : null;
    if (specific && settings.features?.[specific] === false) return res.status(403).json({ error: "This feature is temporarily unavailable." });
    if (req.path === "/auth/register" && settings.features?.registrations === false) return res.status(403).json({ error: "New registrations are temporarily disabled." });
    if (feature && settings.features?.[feature] === false) return res.status(403).json({ error: "This feature is temporarily unavailable." });
    if (key === "editor" && settings.features?.rendering === false) return res.status(403).json({ error: "Rendering is temporarily unavailable." });
    if (key === "youtube" && /\/(uploads|my-videos)/.test(req.path) && settings.features?.publishing === false) return res.status(403).json({ error: "Publishing is temporarily unavailable." });
    next();
  } catch (e) { next(e); }
}
export async function checkGenerationUser(userId: string) { const user = await User.findById(userId); if (user && (user.status === "suspended" || user.aiRestricted)) throw new Error("AI generation is restricted for this account."); }
export async function defaultModel(kind: string, fallback: string) { const binding = await GatewayBinding.findById(kind); if (binding?.model) return binding.model; const policy = await ProviderControl.findOne({ defaultFor: kind, enabled: true }); return policy?.model || (env.OPENROUTER_API_KEY && kind === "text" ? "openrouter/" + env.OPENROUTER_TEXT_MODEL : fallback); }
export async function assertProviderBudget(model: string, estimate: number | null | undefined) { const provider = providerFor(model); const policies = await ProviderControl.find({ model: { $in: [model, `${provider}:*`] } }); for (const control of policies) if (!control.enabled || typeof estimate !== "number" || estimate > control.maxJobCostUsd) throw new Error("Provider model is disabled or estimated spending cannot satisfy its per-job cap."); }
export async function configuredModels<T extends { id: string }>(kind: string, models: T[]) { const binding = await GatewayBinding.findById(kind); const controls = await ProviderControl.find({ model: { $in: models.map(m => m.id) } }); const verified = env.OPENROUTER_API_KEY && ["image", "video", "voice"].includes(kind) ? new Set((await routerCatalog(kind as any).catch(() => [])).map((m: any) => "openrouter/" + m.id)) : new Set<string>(); const presentations = await ModelPresentation.find({ model: { $in: models.map(m => m.id) } }).lean(); return models.map(m => { const p = presentations.find(p => p.model === m.id); return p ? { ...m, label: p.displayName || (m as any).label, qualityTier: p.tier } : m; }).filter(m => (!isOpenRouter(m.id) || !!env.OPENROUTER_API_KEY && verified.has(m.id)) && controls.find(c => c.model === m.id)?.enabled !== false).sort((a, b) => Number(binding?.model === b.id || controls.find(c => c.model === b.id)?.defaultFor === kind) - Number(binding?.model === a.id || controls.find(c => c.model === a.id)?.defaultFor === kind)); }
export async function withProvider<T>(model: string, execute: () => Promise<T>): Promise<T> {
  if (executionContext.getStore()?.has(model)) return execute();
  const executeScoped = () => executionContext.run(new Set([...(executionContext.getStore() || []), model]), execute);
  const provider = providerFor(model);
  const group = await ProviderControl.findOne({ model: `${provider}:*` });
  const control = await ProviderControl.findOne({ model }); if (!control && !group) return executeScoped();
  const session = await mongoose.startSession(); let lease: any;
  try { await session.withTransaction(async () => {
    for (const policy of [group, control].filter(Boolean) as any[]) {
      const c = await ProviderControl.findOneAndUpdate({ _id: policy._id }, { $set: { updatedAt: new Date() } }, { new: true, session }); if (!c?.enabled) throw new Error("This provider/model is disabled by an administrator.");
      const count = await ProviderLease.countDocuments({ ...(policy.model.endsWith(":*") ? { provider } : { model }), expiresAt: { $gt: new Date() } }).session(session); if (count >= c.maxConcurrent) throw new Error("Provider concurrency limit reached. Try again later.");
      const dailyId = `${policy.model}:${new Date().toISOString().slice(0, 10)}`; const daily = await ProviderDaily.findById(dailyId).session(session); if ((daily?.count || 0) >= c.maxDailyJobs) throw new Error("Provider daily usage limit reached.");
      await ProviderDaily.updateOne({ _id: dailyId }, { $inc: { count: 1 } }, { upsert: true, session });
    }
    [lease] = await ProviderLease.create([{ model, provider, expiresAt: new Date(Date.now() + 300000) }], { session });
  }); } finally { await session.endSession(); }
  const heartbeat = setInterval(() => void ProviderLease.updateOne({ _id: lease._id }, { $set: { expiresAt: new Date(Date.now() + 300000) } }).catch(() => {}), 60000); heartbeat.unref();
  try { return await executeScoped(); } finally { clearInterval(heartbeat); await ProviderLease.deleteOne({ _id: lease._id }); }
}
