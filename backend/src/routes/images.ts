import { configuredModels } from "../services/platformControl.js";
import { managedPrice, rememberQuote, approvedTerms } from "../services/managedPricing.js";
import { Router } from "express";
import { z } from "zod";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { ImageGenerationJob } from "../models/ImageGenerationJob.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { imageCreditCost, imageModels, stylePresets, validateImageSettings } from "../services/imageGeneration.js";
import { enqueueImageJob } from "../services/imageQueue.js";
import { deleteImageObject, signedImageUrl } from "../services/mediaStorage.js";
import { reserveCredits } from "../services/wallet.js";
import { processImageJob } from "../workers/processImageJob.js";
import { env } from "../config/env.js";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { openMediaStream } from "../services/mediaStorage.js";
import { emitImageJob } from "../realtime.js";

export const imagesRouter = Router();
imagesRouter.use(requireAuth, requireCsrf);

const requestSchema = z.object({
  prompt: z.string().min(3).max(4000),
  stylePreset: z.string().optional(),
  model: z.string(),
  aspectRatio: z.string(),
  resolution: z.string(),
  numberOfImages: z.number().min(1).max(4),
  characterReferenceIds: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  approvedCredits: z.number().optional()
});

imagesRouter.get("/config", async (req, res) => {
  const characters = await CharacterProfile.find({ userId: req.user._id }).sort({ updatedAt: -1 });
  res.json({ models: await configuredModels("image", imageModels), stylePresets, characters, queueEnabled: env.IMAGE_QUEUE_ENABLED, storageConfigured: Boolean(env.R2_BUCKET) });
});

imagesRouter.post("/quote", async (req, res, next) => {
  try {
    const settings = validateImageSettings(requestSchema.partial({ approvedCredits: true }).parse(req.body));
    res.json({ quote: { ...(await rememberQuote(req.user._id, settings, await managedPrice("text_to_image", "gemini", settings, imageCreditCost(settings)))), settings } });
  } catch (error) {
    next(error);
  }
});

imagesRouter.post("/generate", async (req, res, next) => {
  try {
    const settings = validateImageSettings(requestSchema.parse(req.body));
    const terms = await approvedTerms(req.user._id, settings, settings.approvedCredits, () => managedPrice("text_to_image", "gemini", settings, imageCreditCost(settings)));
    const credits = terms.credits;
    if (settings.approvedCredits !== credits) return res.status(400).json({ error: `Approve ${credits} credits before generating.` });
    const reservation: any = await reserveCredits(String(req.user._id), terms, `image:${req.user._id}:${Date.now()}:${settings.prompt.slice(0, 24)}`);
    const job = await ImageGenerationJob.create({ ...settings, userId: req.user._id, reservationId: reservation?._id, provider: "gemini", status: "queued", approvedCredits: credits });
    emitImageJob(String(job._id), { status: job.status, job });
    const queued = await enqueueImageJob(String(job._id));
    if (!queued) {
      processImageJob(String(job._id))
        .then(() => ImageGenerationJob.findById(job._id).then((fresh) => emitImageJob(String(job._id), { status: fresh?.status, job: fresh })))
        .catch(() => null);
    }
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

imagesRouter.get("/jobs", async (req, res) => {
  const jobs = await ImageGenerationJob.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const assets = await MediaAsset.find({ userId: req.user._id, type: "image", provider: { $ne: "upload" }, deletedAt: null }).sort({ createdAt: -1 }).limit(100);
  res.json({ jobs, assets });
});

imagesRouter.get("/jobs/:id", async (req, res) => {
  const job = await ImageGenerationJob.findOne({ _id: req.params.id, userId: req.user._id });
  const assets = await MediaAsset.find({ jobId: req.params.id, userId: req.user._id, deletedAt: null });
  res.json({ job, assets });
});

imagesRouter.get("/assets/:id/url", async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.user._id, deletedAt: null });
  if (!asset) return res.status(404).json({ error: "Image not found" });
  res.json({ url: asset.url?.startsWith("data:") ? asset.url : await signedImageUrl(asset.key) || asset.url });
});

imagesRouter.get("/assets/:id/download", async (req, res, next) => {
  try {
    const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.user._id, type: "image", deletedAt: null });
    if (!asset) return res.status(404).json({ error: "Image not found" });
    res.set({ "Content-Type": asset.contentType || "image/png", "Content-Disposition": `attachment; filename="thumbnail-${asset._id}.${asset.contentType === "image/jpeg" ? "jpg" : "png"}"`, "Cache-Control": "private, no-store" });
    if (asset.url?.startsWith("data:")) return res.send(Buffer.from(asset.url.split(",")[1], "base64"));
    const object = await openMediaStream(asset.key); if (!object.Body) return res.status(404).end();
    await pipeline(object.Body as Readable, res);
  } catch (e) { next(e); }
});

imagesRouter.delete("/assets/:id", async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.user._id });
  if (!asset) return res.status(404).json({ error: "Image not found" });
  asset.deletedAt = new Date();
  await asset.save();
  await deleteImageObject(asset.key).catch(() => null);
  res.json({ ok: true });
});
