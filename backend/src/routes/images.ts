import { dispatchGeneration } from "../services/generationDispatch.js";
import { providerFor } from "../services/openrouter.js";
import { configuredModels } from "../services/platformControl.js";
import { managedPrice, rememberQuote, approvedTerms } from "../services/managedPricing.js";
import { Router } from "express";
import { z } from "zod";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { ImageGenerationJob } from "../models/ImageGenerationJob.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { imageCreditCost, imageModels, stylePresets, validateImageSettings } from "../services/imageGeneration.js";
import { assertImageQueueReady, enqueueImageJob } from "../services/imageQueue.js";
import { deleteImageObject, signedImageUrl } from "../services/mediaStorage.js";
import { reserveCredits, releaseReservation } from "../services/wallet.js";
import { processImageJob } from "../workers/processImageJob.js";
import { env } from "../config/env.js";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { openMediaStream } from "../services/mediaStorage.js";
import { emitImageJob } from "../realtime.js";
import { imageReferences } from "../services/imageReferences.js";
import { imageStudioRouter } from "./imageStudio.js";

export const imagesRouter = Router();
imagesRouter.use(requireAuth, requireCsrf);
imagesRouter.use(imageStudioRouter);

const requestSchema = z.object({
  prompt: z.string().min(3).max(4000),
  stylePreset: z.string().optional(),
  model: z.string(),
  aspectRatio: z.string(),
  resolution: z.string(),
  numberOfImages: z.number().int().min(1).max(10),
  characterReferenceIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(4).default([]),
  projectId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  sourceAssetIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(4).default([]),
  tool: z.enum(["generate", "editor", "characters", "variations", "product", "thumbnail", "batch", "style", "background"]).default("generate"),
  background: z.literal("transparent").optional(),
  requestId: z.string().uuid().optional(),
  approvedCredits: z.number().optional()
});

imagesRouter.get("/config", async (req, res) => {
  const characters = await CharacterProfile.find({ userId: req.user._id }).sort({ updatedAt: -1 });
  res.json({ models: await configuredModels("image", imageModels), stylePresets, characters, queueEnabled: env.IMAGE_QUEUE_ENABLED, storageConfigured: Boolean(env.R2_BUCKET) });
});

imagesRouter.post("/quote", async (req, res, next) => {
  try {
    const settings = validateImageSettings(requestSchema.partial({ approvedCredits: true }).parse(req.body));
    await imageReferences(req.user._id, settings);
    res.json({ quote: { ...(await rememberQuote(req.user._id, settings, await managedPrice("text_to_image", providerFor(settings.model), settings, imageCreditCost(settings)))), settings } });
  } catch (error) {
    next(error);
  }
});

imagesRouter.post("/generate", async (req, res, next) => {
  let job: any, reservation: any;
  try {
    const settings = validateImageSettings(requestSchema.parse(req.body));
    if (settings.requestId) { const existing = await ImageGenerationJob.findOne({ userId: req.user._id, requestId: settings.requestId }); if (existing) return res.status(202).json({ job: existing }); }
    await imageReferences(req.user._id, settings);
    const terms = await approvedTerms(req.user._id, settings, settings.approvedCredits, () => managedPrice("text_to_image", providerFor(settings.model), settings, imageCreditCost(settings)));
    const credits = terms.credits;
    if (settings.approvedCredits !== credits) return res.status(400).json({ error: `Approve ${credits} credits before generating.` });

    reservation = await reserveCredits(String(req.user._id), terms, `image:${req.user._id}:${settings.requestId || Date.now() + ":" + settings.prompt.slice(0, 24)}`);
    job = await ImageGenerationJob.create({ ...settings, model: terms.model || settings.model, userId: req.user._id, reservationId: reservation?._id, provider: providerFor(terms.model || settings.model), status: "queued", approvedCredits: credits });
    emitImageJob(String(job._id), { status: job.status, job });
    await dispatchGeneration("image", String(job._id));
    res.status(202).json({ job });
  } catch (error) {
    if ((error as any)?.code === 11000 && req.body.requestId) { const existing = await ImageGenerationJob.findOne({ userId: req.user._id, requestId: req.body.requestId }); if (existing) return res.status(202).json({ job: existing }); }
    const failed = job ? await ImageGenerationJob.findOneAndUpdate({ _id: job._id, status: "queued" }, { status: "failed", error: "Queue submission failed. Reserved credits released." }) : null;
    if (reservation && (!job || failed)) await releaseReservation(String(reservation._id), "queue_submission_failed");
    if (job && !failed) return res.status(202).json({ job: await ImageGenerationJob.findById(job._id) });
    next(error);
  }
});

imagesRouter.get("/jobs", async (req, res) => {
  const jobs = await ImageGenerationJob.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const assets = await MediaAsset.find({ userId: req.user._id, type: "image", deletedAt: null }).sort({ createdAt: -1 }).limit(100);
  res.json({ jobs, assets: await Promise.all(assets.map(async asset => ({ ...asset.toObject(), url: asset.url?.startsWith("data:") ? asset.url : await signedImageUrl(asset.key) || asset.url }))) });
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
