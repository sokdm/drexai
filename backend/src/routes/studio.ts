import { assetPackRouter } from "./assetPacks.js";
import { configuredModels } from "../services/platformControl.js";
import { ensureProductionEdit, applyProductionEdit } from "../services/sharedEditing.js";
import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { StudioEvent, StudioProduction } from "../models/StudioProduction.js";
import { AIProject } from "../models/AIProject.js";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { Niche } from "../models/Niche.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { buildStudioSteps, StudioStep, studioSettingsSchema } from "../services/studioPlan.js";
import { priceStudioSteps } from "../services/studioPricing.js";
import { imageModels } from "../services/imageGeneration.js";
import { videoModels } from "../services/videoGeneration.js";
import { ttsModels } from "../services/textToSpeech.js";
import { persistentStorageConfigured, signedImageUrl } from "../services/mediaStorage.js";
import { enqueueStudio, studioWorkerOnline } from "../services/studioQueue.js";
import { reserveCredits } from "../services/wallet.js";
import { closeStudioReserve } from "../services/studioBilling.js";
import { studioLog } from "../services/studioExecution.js";

export const studioRouter = Router();
studioRouter.use(requireAuth, requireCsrf, rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }));
studioRouter.use(assetPackRouter);
const idSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
function fail(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
async function own(req: Request) {
  const production = await StudioProduction.findOne({ _id: idSchema.parse(req.params.id), userId: req.user._id });
  if (!production) fail("Production not found", 404);
  return production!;
}
async function readiness() {
  return { queueEnabled: env.STUDIO_QUEUE_ENABLED, storageConfigured: persistentStorageConfigured(), providerConfigured: Boolean(env.GEMINI_API_KEY || env.OPENROUTER_API_KEY), workerOnline: await studioWorkerOnline() };
}

studioRouter.get("/config", wrap(async (req, res) => {
  const projects = await AIProject.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(100).lean();
  const characters = await CharacterProfile.find({ userId: req.user._id }).lean();
  res.json({ commercialEnabled: (await (await import("../services/creditPricingEngine.js")).getPricingPolicy()).values.commercialEnabled, imageModels: await configuredModels("image", imageModels), videoModels: await configuredModels("video", videoModels), voiceModels: await configuredModels("voice", ttsModels), projects, characters, readiness: await readiness() });
}));
studioRouter.get("/productions", wrap(async (req, res) => {
  const query: any = { userId: req.user._id };
  if (req.query.projectId) query.projectId = idSchema.parse(req.query.projectId);
  res.json({ productions: await StudioProduction.find(query).select("title status projectId estimate maxCredits createdAt updatedAt").sort({ createdAt: -1 }).limit(50) });
}));

studioRouter.post("/plans", wrap(async (req, res) => {
  const input = z.object({ projectId: idSchema, settings: studioSettingsSchema, sourceProductionId: idSchema.optional(), regenerateStepKey: z.string().max(150).optional() }).parse(req.body);
  const project = await AIProject.findOne({ _id: input.projectId, userId: req.user._id }).lean();
  if (!project || !project.approvedAt) fail("Approve the script before creating a production plan");
  const characters = await CharacterProfile.find({ projectId: project!._id, userId: req.user._id }).lean();
  const refs = [];
  for (const character of characters) {
    const reference = character.referenceImageUrl ? await MediaAsset.findOne({ userId: req.user._id, type: "image", deletedAt: null, url: character.referenceImageUrl }).select("_id") : null;
    refs.push({ ...character, referenceAssetId: reference ? String(reference._id) : undefined });
  }
  const niche = project!.nicheId ? await Niche.findOne({ _id: project!.nicheId, userId: req.user._id }).lean() : null;
  let snapshot: any = JSON.parse(JSON.stringify({ title: project!.title, summary: project!.summary, scenes: project!.scenes, characters: refs, niche, product: (project!.prompts as any)?.sourceSettings?.product }));
  let settings = input.settings;
  let source: any;
  if (input.sourceProductionId) {
    source = await StudioProduction.findOne({ _id: input.sourceProductionId, userId: req.user._id, projectId: input.projectId });
    if (!source || !["completed", "cancelled", "failed", "needs_review", "paused"].includes(source.status) || source.leaseUntil > new Date()) fail("Pause production before regenerating an output");
    snapshot = source.snapshot; settings = studioSettingsSchema.parse(source.settings);
  }
  if (snapshot.product) {
    if (!(await (await import("../services/creditPricingEngine.js")).getPricingPolicy()).values.commercialEnabled) fail("Product commercials are disabled by the administrator");
    const ids = snapshot.product.assetIds || [];
    if (await MediaAsset.countDocuments({ _id: { $in: ids }, userId: req.user._id, type: "image", deletedAt: null }) !== new Set(ids).size) fail("Product reference images are unavailable");
  }
  const steps = buildStudioSteps(snapshot, settings);
  if (source) {
    const selected = source.steps.find((s: StudioStep) => s.key === input.regenerateStepKey);
    if (!selected) fail("Select an output to regenerate");
    for (const step of steps) {
      const old = source.steps.find((s: StudioStep) => s.key === step.key);
      const dependsOnSelection = step.key === selected.key || (step.sceneId === selected.sceneId && step.kind === "video" && selected.kind !== "video");
      if (old?.status === "completed" && old.assetId && !dependsOnSelection && (step.kind !== "video" || old.input.nativeAudio === true) && (step.kind !== "audio" || old.input.track === step.input.track)) { step.status = "completed"; step.assetId = old.assetId; step.reused = true; }
    }
  }
  const estimate = await priceStudioSteps(steps);
  const production = await StudioProduction.create({ userId: req.user._id, projectId: input.projectId, sourceProductionId: source ? String(source._id) : undefined, title: project!.title, snapshot, settings, steps, estimate, expiresAt: new Date(Date.now() + 10 * 60000) });
  await studioLog(production, "waiting", "Production plan prepared. Awaiting credit approval.");
  res.status(201).json({ production });
}));

studioRouter.get("/productions/:id", wrap(async (req, res) => {
  const production = await own(req);
  const assetIds = production.steps.map((s: any) => s.assetId).filter(Boolean);
  const assets = await MediaAsset.find({ _id: { $in: assetIds }, userId: req.user._id, deletedAt: null }).lean();
  const events = await StudioEvent.find({ productionId: production._id, userId: req.user._id }).sort({ _id: -1 }).limit(300).lean();
  res.json({ production, assets: assets.map(a => ({ ...a, url: undefined })), events: events.reverse() });
}));
studioRouter.get("/productions/:id/edit", wrap(async (req, res) => {
 const production = await own(req);
 if (!production.timeline?.length) return res.status(409).json({ error: "Complete the production rough cut before editing." });
 const edit = await ensureProductionEdit(production), timeline = edit.timeline;
 const ids = [...timeline.clips.map((c: any) => c.assetId), ...timeline.audio.map((a: any) => a.assetId)].filter(Boolean);
 res.json({ edit, assets: await MediaAsset.find({ _id: { $in: ids }, userId: req.user._id, deletedAt: null }).select("type durationSeconds metadata sceneId").lean() });
}));
studioRouter.post("/productions/:id/edit-command", wrap(async (req, res) => {
 const production = await own(req), input = z.object({ message: z.string().min(3).max(1000), revision: z.number().int().nonnegative() }).parse(req.body);
 if (!production.timeline?.length) return res.status(409).json({ error: "Complete the production rough cut before editing." });
 res.json(await applyProductionEdit(production, input.message, input.revision));
}));

studioRouter.post("/productions/:id/approve", wrap(async (req, res) => {
  const production = await own(req);
  if ((production.snapshot as any)?.product && !(await (await import("../services/creditPricingEngine.js")).getPricingPolicy()).values.commercialEnabled) fail("Product commercials are disabled by the administrator");
  const { maxCredits } = z.object({ maxCredits: z.number().int().nonnegative().max(1000000) }).parse(req.body);
  if (production.status !== "draft") {
    if (production.approvedAt) return res.json({ production });
    fail("This plan cannot be approved");
  }
  if (!production.expiresAt || production.expiresAt < new Date()) fail("Quote expired; prepare a new plan");
  if (production.estimate.missingPricing.length || production.estimate.credits == null) fail("Verified model pricing must be configured before execution");
  if (maxCredits < production.estimate.credits) fail("Spending limit is lower than the production estimate");
  const ready = await readiness();
  if (!Object.values(ready).every(Boolean)) fail("Configure Redis, R2, Gemini, and start the Studio worker before approving paid generation", 503);
  const session = await mongoose.startSession();
  let updated: any;
  try {
    await session.withTransaction(async () => {
      const fresh = await StudioProduction.findOne({ _id: production._id, status: "draft", control: { $ne: "cancel" } }).session(session);
      if (!fresh) return;
      if (production.sourceProductionId) {
        const source = await StudioProduction.findOne({ _id: production.sourceProductionId, userId: req.user._id }).session(session);
        if (source && !["completed", "cancelled"].includes(source.status)) {
          if (!["paused", "failed", "needs_review"].includes(source.status) || (source.leaseUntil && source.leaseUntil > new Date())) fail("Source production is active");
          source.status = "cancelled"; source.control = "cancel";
          await source.save({ session });
          if (source.reservationId) await closeStudioReserve(String(source.reservationId), "replaced_by_regeneration_plan", session);
        }
      }
      const reservation: any = await reserveCredits(String(req.user._id), { credits: maxCredits, feature: "ai_studio_production", productionId: production._id, ...(production.steps.some((s: any) => s.input.model.startsWith("openrouter/")) ? { provider: "openrouter", estimatedCostUsd: production.steps.filter((s: any) => !s.reused && s.input.model.startsWith("openrouter/")).reduce((total: number, s: any) => total + Number(s.pricing?.providerCostUsd || 0), 0) } : {}) }, `studio-budget:${production._id}`, session);
      updated = await StudioProduction.findOneAndUpdate({ _id: production._id, status: "draft" }, { $set: { reservationId: reservation._id, maxCredits: reservation.credits, approvedAt: new Date(), status: "queued", control: "run" }, $inc: { queueRevision: 1 } }, { new: true, session });
    });
  } finally { await session.endSession(); }
  if (updated) {
    for (const [name, voicePreference] of Object.entries(updated.settings.characterVoices ?? {})) await CharacterProfile.updateOne({ projectId: updated.projectId, userId: req.user._id, name }, { $set: { voicePreference } });
    await studioLog(updated, "waiting", `Production approved with a maximum of ${updated.maxCredits} credits.`);
    await enqueueStudio(updated).catch(() => null);
  }
  res.json({ production: updated ?? await own(req) });
}));

studioRouter.post("/productions/:id/control", wrap(async (req, res) => {
  const production = await own(req);
  const { action } = z.object({ action: z.enum(["pause", "resume", "cancel", "retry"]) }).parse(req.body);
  if (["completed", "cancelled"].includes(production.status)) return res.json({ production });
  if (action === "pause") {
    await StudioProduction.updateOne({ _id: production._id, status: { $in: ["queued", "running"] } }, { $set: { control: "pause" } });
  } else if (action === "cancel") {
    await StudioProduction.updateOne({ _id: production._id }, { $set: { control: "cancel" } });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const cancelled = await StudioProduction.findOneAndUpdate({ _id: production._id, status: { $nin: ["completed", "cancelled"] }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { status: "cancelled" } }, { new: true, session });
        if (cancelled?.reservationId) await closeStudioReserve(String(cancelled.reservationId), "production_cancelled", session);
      });
    } finally { await session.endSession(); }
  } else {
    if (!["paused", "failed"].includes(production.status)) fail("Only paused or failed work can resume. Uncertain provider requests require a new regeneration quote.");
    if (!await studioWorkerOnline()) fail("Studio worker is offline", 503);
    const steps = production.steps.map((s: StudioStep) => s.status === "failed" ? { ...s, status: "pending", error: undefined } : s);
    const updated = await StudioProduction.findOneAndUpdate({ _id: production._id, status: production.status, control: { $ne: "cancel" }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { status: "queued", control: "run", steps, error: "" }, $inc: { queueRevision: 1 } }, { new: true });
    if (!updated) fail("Wait for the current operation to finish");
    await enqueueStudio(updated).catch(() => null);
  }
  await studioLog(production, action === "cancel" ? "cancelled" : "waiting", `${action} requested. Already-submitted provider work may finish before pending work stops.`);
  res.json({ production: await own(req) });
}));

studioRouter.get("/assets/:assetId/url", wrap(async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: idSchema.parse(req.params.assetId), userId: req.user._id, deletedAt: null });
  if (!asset) fail("Asset not found", 404);
  const url = asset!.url?.startsWith("data:") ? asset!.url : await signedImageUrl(asset!.key);
  if (!url) fail("Asset storage is unavailable", 503);
  res.json({ url });
}));

studioRouter.get("/productions/:id/events", wrap(async (req, res) => {
  const production = await own(req);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.flushHeaders();
  let cursor = String(req.headers["last-event-id"] ?? req.query.after ?? "");
  if (cursor && !idSchema.safeParse(cursor).success) cursor = "";
  let closed = false, inFlight = false;
  async function flush() {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const events = await StudioEvent.find({ productionId: production._id, userId: req.user._id, ...(cursor ? { _id: { $gt: cursor } } : {}) }).sort({ _id: 1 }).limit(100).lean();
      for (const event of events) {
        cursor = String(event._id);
        if (!closed) res.write(`id: ${cursor}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
      }
      if (!closed) res.write(": heartbeat\n\n");
    } catch { if (!closed) res.write("event: reconnect\ndata: {}\n\n"); }
    finally { inFlight = false; }
  }
  const timer = setInterval(() => { void flush(); }, 2000);
  const expiry = setTimeout(() => res.end(), 5 * 60000);
  req.on("close", () => { closed = true; clearInterval(timer); clearTimeout(expiry); });
  await flush();
}));

studioRouter.post("/assets/:assetId/audio-review", wrap(async (req, res) => {
  const input = z.object({ status: z.enum(["accepted", "issue"]), note: z.string().max(1000).default(""), transcript: z.string().max(8000).optional() }).parse(req.body);
  const asset = await MediaAsset.findOne({ _id: idSchema.parse(req.params.assetId), userId: req.user._id, type: "video", deletedAt: null });
  if (!asset || !asset.metadata?.nativeAudio) fail("Native audiovisual asset not found", 404);
  const review = { ...asset!.metadata.audioReview, status: input.status, note: input.note, reviewedAt: new Date().toISOString(), reviewedBy: String(req.user._id), method: "user_review" };
  asset!.set("metadata.audioReview", review);
  if (input.transcript !== undefined) asset!.set("metadata.verifiedTranscript", { text: input.transcript, source: "user_listened_to_audio", reviewedAt: new Date().toISOString() });
  await asset!.save();
  if (asset!.productionId) await studioLog({ _id: asset!.productionId, userId: req.user._id }, "review", "Native audio review: " + input.status + (input.note ? ". " + input.note : ""), asset!.productionStepKey || undefined);
  res.json({ asset: asset!.toObject() });
}));
