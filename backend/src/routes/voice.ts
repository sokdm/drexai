import { configuredModels } from "../services/platformControl.js";
import { managedPrice, rememberQuote, approvedTerms } from "../services/managedPricing.js";
import { Router } from "express";
import { z } from "zod";
import { AIProject } from "../models/AIProject.js";
import { AudioGenerationJob } from "../models/AudioGenerationJob.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { deleteImageObject, signedImageUrl, uploadAudio } from "../services/mediaStorage.js";
import { reserveCredits, releaseReservation, settleReservation } from "../services/wallet.js";
import { generateGeminiSpeech, ttsCreditCost, ttsModels, validateTtsSettings } from "../services/textToSpeech.js";

export const voiceRouter = Router();
voiceRouter.use(requireAuth, requireCsrf);

const requestSchema = z.object({
  text: z.string().optional(),
  model: z.string(),
  voiceId: z.string(),
  language: z.string(),
  style: z.string().optional(),
  mode: z.enum(["single", "multi"]).default("single"),
  speakers: z.array(z.object({ speaker: z.string(), voice: z.string(), text: z.string(), style: z.string().optional() })).default([]),
  projectId: z.string().optional(),
  sceneId: z.string().optional(),
  characterName: z.string().optional(),
  approvedCredits: z.number().optional()
});

voiceRouter.get("/config", async (req, res) => {
  const projects = await AIProject.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(50);
  res.json({ models: await configuredModels("voice", ttsModels), projects });
});

voiceRouter.post("/quote", async (req, res, next) => {
  try {
    const settings = validateTtsSettings(requestSchema.partial({ approvedCredits: true }).parse(req.body));
    res.json({ quote: { ...(await rememberQuote(req.user._id, settings, await managedPrice("voice_generation", "gemini", settings, ttsCreditCost(settings)))), settings } });
  } catch (error) { next(error); }
});

voiceRouter.post("/generate", async (req, res, next) => {
  let reservation: any;
  let job: any;
  try {
    const settings = validateTtsSettings(requestSchema.parse(req.body));
    const terms = await approvedTerms(req.user._id, settings, settings.approvedCredits, () => managedPrice("voice_generation", "gemini", settings, ttsCreditCost(settings)));
    const credits = terms.credits;
    if (settings.approvedCredits !== credits) return res.status(400).json({ error: `Approve ${credits} credits before generating.` });
    reservation = await reserveCredits(String(req.user._id), terms, `voice:${req.user._id}:${Date.now()}:${(settings.text ?? "").slice(0, 24)}`);
    job = await AudioGenerationJob.create({ ...settings, userId: req.user._id, reservationId: reservation?._id, provider: "gemini", status: "processing", attempts: 1, approvedCredits: credits });
    const output = await generateGeminiSpeech(settings);
    const key = `${req.user._id}/audio/${job._id}.wav`;
    const stored = await uploadAudio(output.buffer, key, output.contentType);
    const asset = await MediaAsset.create({ userId: req.user._id, projectId: settings.projectId, sceneId: settings.sceneId, characterName: settings.characterName, voiceId: settings.voiceId, jobId: job._id, type: "audio", prompt: settings.text, provider: "gemini", model: settings.model, key: stored.key, bucket: stored.bucket, url: stored.url, contentType: output.contentType, sizeBytes: output.buffer.length, durationSeconds: output.durationSeconds, metadata: { style: settings.style, mode: settings.mode } });
    job.status = "completed"; job.durationSeconds = output.durationSeconds; job.outputMetadata = { assetId: asset._id }; job.completedAt = new Date();
    await job.save();
    await settleReservation(String(reservation._id));
    res.status(201).json({ job, asset });
  } catch (error) {
    if (job) { job.status = "failed"; job.error = error instanceof Error ? error.message : "TTS failed"; await job.save().catch(() => null); }
    if (reservation?._id) await releaseReservation(String(reservation._id), "voice_generation_failed").catch(() => null);
    next(error);
  }
});

voiceRouter.get("/library", async (req, res) => {
  const jobs = await AudioGenerationJob.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const assets = await MediaAsset.find({ userId: req.user._id, type: "audio", deletedAt: null }).sort({ createdAt: -1 }).limit(100);
  res.json({ jobs, assets });
});

voiceRouter.get("/assets/:id/url", async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.user._id, type: "audio", deletedAt: null });
  if (!asset) return res.status(404).json({ error: "Audio not found" });
  res.json({ url: asset.url?.startsWith("data:") ? asset.url : await signedImageUrl(asset.key) || asset.url });
});

voiceRouter.patch("/assets/:id", async (req, res) => res.json({ asset: await MediaAsset.findOneAndUpdate({ _id: req.params.id, userId: req.user._id, type: "audio" }, { "metadata.name": req.body.name, projectId: req.body.projectId, sceneId: req.body.sceneId }, { new: true }) }));
voiceRouter.delete("/assets/:id", async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.user._id, type: "audio" });
  if (!asset) return res.status(404).json({ error: "Audio not found" });
  asset.deletedAt = new Date(); await asset.save(); await deleteImageObject(asset.key).catch(() => null); res.json({ ok: true });
});
