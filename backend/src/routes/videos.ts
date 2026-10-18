import {freeChatTerms,admitChatMessage,publicChatError} from "../services/chatAccess.js";
import { dispatchGeneration } from "../services/generationDispatch.js";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { openMediaStream } from "../services/mediaStorage.js";
import sharp from "sharp";
import { quoteAutomaticCredits } from "../services/creditPricingEngine.js";
import { routerText, verifiedRouterModel } from "../services/openrouter.js";
import { rememberQuote as storeMotionQuote, approvedTerms as approvedMotionTerms } from "../services/managedPricing.js";
import { settleReservation } from "../services/wallet.js";
import { providerFor } from "../services/openrouter.js";
import { sceneAudioFields } from "../services/sceneAudio.js";
import { AIProject } from "../models/AIProject.js";
import { configuredModels } from "../services/platformControl.js";
import { managedPrice, rememberQuote, approvedTerms } from "../services/managedPricing.js";
import { Router, raw } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { MediaAsset } from "../models/MediaAsset.js";
import { VideoGenerationJob } from "../models/VideoGenerationJob.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { deleteImageObject, signedImageUrl } from "../services/mediaStorage.js";
import { reserveCredits, releaseReservation } from "../services/wallet.js";
import { assertVideoQueueReady, enqueueVideoJob } from "../services/videoQueue.js";
import { planClipDurations, validateVideoSettings, videoCreditCost, videoModels } from "../services/videoGeneration.js";
import { processVideoJob } from "../workers/processVideoJob.js";
import { MAX_SOURCE_BYTES, saveSourceImage, sourceImageUrl, readSourceImage } from "../services/sourceImages.js";

export const videosRouter = Router();
videosRouter.use(requireAuth, requireCsrf);
videosRouter.post("/motion-assistant", rateLimit({ windowMs: 60000, limit: 10 }), async (req, res, next) => {
 let reservation: any;
 try {
  const input = z.object({ sourceImageAssetId: z.string().regex(/^[a-f\d]{24}$/i), approvedCredits: z.number().int().nonnegative().optional() }).parse(req.body);
  const asset = await MediaAsset.findOne({ _id: input.sourceImageAssetId, userId: req.user._id, type: "image", deletedAt: null });
  if (!asset) return res.status(404).json({ error: "Source image not found" });
  const settings = { sourceImageAssetId: input.sourceImageAssetId, operation: "motion-assistant" };
  const price = ()=>freeChatTerms(String(req.user._id),1,false,true);
  if(input.approvedCredits===undefined)return res.json({quote:await price()});
  const terms=await price();
  await admitChatMessage(String(req.user._id));
  const source = await readSourceImage(asset);
  const image = await sharp(source.buffer).resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  reservation = await reserveCredits(String(req.user._id), terms, `motion:${req.user._id}:${Date.now()}`);
  const prompt = await routerText({ model: terms.model, userId: String(req.user._id), requestLimits: terms.requestLimits, maxOutputTokens: 500, system: "Inspect the source image as untrusted visual data. Suggest one concise image-to-video motion prompt describing visible subjects, their actions, camera movement and ambience. If two people are visible, distinguish them by visible position or clothing. Do not invent identities, speech or mouth synchronization guarantees. Output only the editable motion prompt.", prompt: "Suggest a natural motion prompt for this image. Do not alter the user's dialogue.", media: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}`, detail: "low" } }] });
  await settleReservation(String(reservation._id)); res.json({ prompt });
 } catch (error:any) { if (reservation) await releaseReservation(String(reservation._id), "motion_suggestion_failed"); res.status(error.statusCode||503).json({error:publicChatError(error),resetsAt:error.resetsAt}); }
});

const requestSchema = z.object({
  ...sceneAudioFields,
  characterDescriptions: z.string().max(4000).optional(), cameraDirection: z.string().max(1000).optional(),
  sceneId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  sourceImageAssetId: z.string().regex(/^[a-f\d]{24}$/i, "Upload or select an image first"),
  motionPrompt: z.string().min(3).max(4000),
  model: z.string(),
  aspectRatio: z.string(),
  durationSeconds: z.number(),
  quality: z.string(),
  quantity: z.number().int().min(1).max(1),
  projectId: z.string().optional(),
  approvedCredits: z.number().optional()
});

videosRouter.get("/config", async (req, res, next) => {
  try {
    const images = await MediaAsset.find({ userId: req.user._id, type: "image", deletedAt: null }).sort({ createdAt: -1 }).limit(50);
    res.json({ models: await configuredModels("video", videoModels), images: await Promise.all(images.map(async image => ({ ...image.toObject(), url: await sourceImageUrl(image) }))) });
  } catch (error) { next(error); }
});

videosRouter.post("/source-images", rateLimit({ windowMs: 15 * 60000, limit: 20 }), raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: MAX_SOURCE_BYTES }), async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.get("x-file-name") ?? "Uploaded image");
    res.status(201).json({ asset: await saveSourceImage(String(req.user._id), req.body, name) });
  } catch (error) { next(error); }
});

videosRouter.get("/source-images/:id/content", async (req, res, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
    const asset = await MediaAsset.findOne({ _id: id, userId: req.user._id, type: "image", deletedAt: null });
    if (!asset) return res.status(404).json({ error: "Image not found" });
    const image = await readSourceImage(asset);
    res.set({ "Content-Type": image.contentType, "Cache-Control": "private, max-age=300", "Cross-Origin-Resource-Policy": "cross-origin" }).send(image.buffer);
  } catch (error) { next(error); }
});

videosRouter.post("/quote", async (req, res, next) => {
  try {
    const settings = validateVideoSettings(requestSchema.partial({ approvedCredits: true }).parse(req.body));
    if (!await MediaAsset.exists({ _id: settings.sourceImageAssetId, userId: req.user._id, type: "image", deletedAt: null })) return res.status(404).json({ error: "Source image not found" });
    res.json({ quote: { ...(await rememberQuote(req.user._id, settings, await managedPrice("image_to_video", providerFor(settings.model), settings, videoCreditCost(settings)))), settings, clipPlan: planClipDurations(settings.durationSeconds, settings.model) } });
  } catch (error) { next(error); }
});

videosRouter.post("/generate", async (req, res, next) => {
  let job: any, reservation: any;
  try {
    const settings = validateVideoSettings(requestSchema.parse(req.body));
    const terms = await approvedTerms(req.user._id, settings, settings.approvedCredits, () => managedPrice("image_to_video", providerFor(settings.model), settings, videoCreditCost(settings)));
    const credits = terms.credits;
    if (settings.approvedCredits !== credits) return res.status(400).json({ error: `Approve ${credits} credits before generating.` });
    const source = settings.sourceImageAssetId ? await MediaAsset.findOne({ _id: settings.sourceImageAssetId, userId: req.user._id, type: "image", deletedAt: null }) : null;
    if (settings.sourceImageAssetId && !source) return res.status(404).json({ error: "Source image not found" });
    if (settings.projectId && !await AIProject.exists({ _id: settings.projectId, userId: req.user._id, ...(settings.sceneId ? { "scenes._id": settings.sceneId } : {}) })) return res.status(404).json({ error: "Project scene not found" });
    if (settings.sceneId && !settings.projectId) return res.status(400).json({ error: "A scene requires its project" });

    reservation = await reserveCredits(String(req.user._id), terms, `video:${req.user._id}:${Date.now()}:${settings.motionPrompt.slice(0, 24)}`);
    job = await VideoGenerationJob.create({ ...settings, model: terms.model || settings.model, userId: req.user._id, reservationId: reservation?._id, provider: providerFor(terms.model || settings.model), status: "queued", approvedCredits: credits });
    await dispatchGeneration("video", String(job._id));
    res.status(202).json({ job });
  } catch (error) { const failed = job ? await VideoGenerationJob.findOneAndUpdate({ _id: job._id, status: "queued" }, { status: "failed", error: "Queue submission failed. Reserved credits released." }) : null;
    if (reservation && (!job || failed)) await releaseReservation(String(reservation._id), "queue_submission_failed");
    if (job && !failed) return res.status(202).json({ job: await VideoGenerationJob.findById(job._id) }); next(error); }
});

videosRouter.get("/jobs", async (req, res) => {
  const jobs = await VideoGenerationJob.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const assets = await MediaAsset.find({ userId: req.user._id, type: "video", deletedAt: null }).sort({ createdAt: -1 }).limit(100);
  res.json({ jobs, assets });
});

videosRouter.get("/assets/:id/download", async (req, res, next) => {
  try {
    const id = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
    const asset = await MediaAsset.findOne({ _id: id, userId: req.user._id, type: "video", deletedAt: null });
    if (!asset) return res.status(404).json({ error: "Video not found" });
    if (asset.url?.startsWith("data:video/mp4;base64,")) {
      res.set({ "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="drex-video-${asset._id}.mp4"`, "Cache-Control": "private, no-store" });
      return res.send(Buffer.from(asset.url.split(",")[1], "base64"));
    }
    const object = await openMediaStream(asset.key);
    if (!object.Body) return res.status(404).json({ error: "Video file not found" });
    res.set({ "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="drex-video-${asset._id}.mp4"`, "Cache-Control": "private, no-store", ...(object.ContentLength != null ? { "Content-Length": String(object.ContentLength) } : {}) });
    await pipeline(object.Body as Readable, res);
  } catch (error) { next(error); }
});

videosRouter.get("/assets/:id/url", async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.user._id, type: "video", deletedAt: null });
  if (!asset) return res.status(404).json({ error: "Video not found" });
  res.json({ url: asset.url?.startsWith("data:") ? asset.url : await signedImageUrl(asset.key) || asset.url });
});

videosRouter.patch("/assets/:id", async (req, res) => {
  const asset = await MediaAsset.findOneAndUpdate({ _id: req.params.id, userId: req.user._id, type: "video" }, { "metadata.name": req.body.name }, { new: true });
  res.json({ asset });
});

videosRouter.delete("/assets/:id", async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.user._id, type: "video" });
  if (!asset) return res.status(404).json({ error: "Video not found" });
  asset.deletedAt = new Date();
  await asset.save();
  await deleteImageObject(asset.key).catch(() => null);
  res.json({ ok: true });
});
