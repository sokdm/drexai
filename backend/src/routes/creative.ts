import { providerFor } from "../services/openrouter.js";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { CreativeJob } from "../models/CreativeJob.js";
import { RenderWorker } from "../models/VideoEdit.js";
import { env } from "../config/env.js";
import { creativeUploadUrl, mediaObjectSize, persistentStorageConfigured, deleteImageObject } from "../services/mediaStorage.js";
import { defaultModel, checkGenerationUser } from "../services/platformControl.js";
import { createQuote, reserveCredits, releaseReservation } from "../services/wallet.js";
import { approvedTerms, rememberQuote } from "../services/managedPricing.js";
export const creativeRouter = Router();
creativeRouter.use(requireAuth, requireCsrf, rateLimit({ windowMs: 60000, limit: 60 }));
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
const id = z.string().regex(/^[a-f0-9]{24}$/i);
const settingsSchema = z.object({ kind: z.literal("shorts"), count: z.number().int().min(5).max(20), fullTranscript: z.boolean().default(false), sourceDurationSeconds: z.number().positive().max(3600).default(3600), maxClipSeconds: z.number().int().min(15).max(90).default(60), sizeBytes: z.number().int().min(100).max(1024 * 1024 * 1024), name: z.string().trim().min(1).max(150) });
async function quoteFor(settings: z.infer<typeof settingsSchema>) {
  const model = await defaultModel("short_clip_analysis", await defaultModel("text", env.GEMINI_MODEL));
  const base = await createQuote({ feature: "short_clip_analysis", provider: providerFor(model), model, unit: "request", quantity: 1 });
  if (settings.kind !== "shorts" || !settings.fullTranscript || !base.allowed) return base;
  const transcription = await createQuote({ feature: "full_video_transcription", provider: "openrouter", model: await defaultModel("full_video_transcription", "openrouter/openai/whisper-large-v3"), unit: "minute", quantity: Math.ceil(settings.sourceDurationSeconds / 60) });
  if (!transcription.allowed) return transcription;
  return { ...base, provider: "openrouter", credits: base.credits + transcription.credits, estimatedCostUsd: (base.estimatedCostUsd || 0) + (transcription.estimatedCostUsd || 0), transcription, note: "Includes full-source transcription for the approved source duration rounded up to the next minute." };
}
creativeRouter.get("/config", wrap(async (req: any, res: any) => res.json({ storageConfigured: persistentStorageConfigured(), analysisConfigured: !!(env.OPENROUTER_API_KEY), workerOnline: !!await RenderWorker.exists({ _id: "creative", expiresAt: { $gt: new Date() } }), maxSourceBytes: 1024 * 1024 * 1024, maxDuration: 3600 })));
creativeRouter.get("/jobs", wrap(async (req: any, res: any) => res.json({ jobs: await CreativeJob.find({ userId: req.user._id, kind: "shorts" }).select("-quote -leaseToken -sourceKey -options.voiceId").sort({ createdAt: -1 }).limit(50) })));
creativeRouter.post("/quote", wrap(async (req: any, res: any) => { const settings = settingsSchema.parse(req.body); res.json({ quote: await rememberQuote(req.user._id, settings, await quoteFor(settings)) }); }));
creativeRouter.post("/jobs", wrap(async (req: any, res: any) => {
  const settings = settingsSchema.parse(req.body), approvedCredits = z.number().nonnegative().parse(req.body.approvedCredits);
  await checkGenerationUser(String(req.user._id));
  if (!persistentStorageConfigured() || !await RenderWorker.exists({ _id: "creative", expiresAt: { $gt: new Date() } })) return res.status(503).json({ error: "Configure storage and start the creative worker before submitting" });
  if (await CreativeJob.countDocuments({ userId: req.user._id, status: { $in: ["uploading", "queued", "processing", "provider_pending"] } }) >= 2) return res.status(429).json({ error: "Finish or cancel an existing creative job first" });
  if (!env.OPENROUTER_API_KEY) return res.status(503).json({ error: "Configure the AI gateway for video analysis" });
  const quote = await approvedTerms(req.user._id, settings, approvedCredits, () => quoteFor(settings));
  if (!quote.allowed || quote.credits !== approvedCredits) throw new Error("Review and approve the current quote first");
  const reservation = await reserveCredits(String(req.user._id), quote, "creative:" + randomUUID());
  let job: any;
  try {
    const sourceKey = `${req.user._id}/short-sources/${randomUUID()}.mp4`;
    job = await CreativeJob.create({ userId: req.user._id, kind: settings.kind, name: settings.name, status: "uploading", sourceKey, sizeBytes: settings.sizeBytes, options: { ...settings }, reservationId: reservation._id, quote });
    res.status(201).json({ job, ...(sourceKey ? { uploadUrl: await creativeUploadUrl(sourceKey, settings.kind === "shorts" ? settings.sizeBytes : 0) } : {}) });
  } catch (e) { if (job) await CreativeJob.deleteOne({ _id: job._id }); await releaseReservation(String(reservation._id), "creative_setup_failed"); throw e; }
}));
creativeRouter.post("/jobs/:id/upload-complete", wrap(async (req: any, res: any) => {
  const job = await CreativeJob.findOne({ _id: id.parse(req.params.id), userId: req.user._id, kind: "shorts" });
  if (!job) return res.status(404).json({ error: "Upload not found" });
  if (job.status !== "uploading") return res.json({ job });
  if (await mediaObjectSize(job.sourceKey!) !== job.sizeBytes) return res.status(400).json({ error: "Source upload is incomplete or exceeds its approved size" });
  await CreativeJob.updateOne({ _id: job._id, status: "uploading" }, { status: "queued" }); res.json({ ok: true });
}));
creativeRouter.post("/jobs/:id/cancel", wrap(async (req: any, res: any) => { const job = await CreativeJob.findOneAndUpdate({ _id: id.parse(req.params.id), userId: req.user._id, status: { $in: ["uploading", "queued"] } }, { status: "cancelled" }, { new: true }); if (!job) return res.status(409).json({ error: "Only waiting jobs can be cancelled" }); await releaseReservation(String(job.reservationId), "creative_cancelled"); if (job.sourceKey) await deleteImageObject(job.sourceKey).catch(() => {}); res.json({ ok: true }); }));
