import {ensureProductionApprovals,approveCreditCard} from "../services/agentApprovals.js";
import {CreditReservation} from "../models/CreditReservation.js";
import { prepareProduction, controlProduction } from "../services/productionTools.js";
import { VideoEdit, VideoExport } from "../models/VideoEdit.js";
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
  return { queueEnabled: env.STUDIO_QUEUE_ENABLED, storageConfigured: persistentStorageConfigured(), providerConfigured: Boolean(env.OPENROUTER_API_KEY), workerOnline: await studioWorkerOnline() };
}

studioRouter.get("/config", wrap(async (req, res) => {
  const projects = await AIProject.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(100).lean();
  const characters = await CharacterProfile.find({ userId: req.user._id }).lean();
  res.json({ commercialEnabled: (await (await import("../services/creditPricingEngine.js")).getPricingPolicy()).values.commercialEnabled, imageModels: await configuredModels("image", imageModels), videoModels: await configuredModels("video", videoModels), voiceModels: (await configuredModels("voice", ttsModels)).filter(m=>m.id.startsWith("openrouter/")||!!env.GEMINI_API_KEY), projects, characters, readiness: await readiness() });
}));
studioRouter.get("/productions", wrap(async (req, res) => {
  const query: any = { userId: req.user._id };
  if (req.query.projectId) query.projectId = idSchema.parse(req.query.projectId);
  res.json({ productions: await StudioProduction.find(query).select("title status projectId estimate maxCredits createdAt updatedAt").sort({ createdAt: -1 }).limit(50) });
}));

studioRouter.post("/plans", wrap(async (req, res) => {
  res.status(201).json({production:await prepareProduction(String(req.user._id),req.body,true)});
}));

studioRouter.get("/productions/:id", wrap(async (req, res) => {
  const production = await own(req);
  const assetIds = production.steps.map((s: any) => s.assetId).filter(Boolean);
  const assets = await MediaAsset.find({ _id: { $in: assetIds }, userId: req.user._id, deletedAt: null }).lean();
  const events = await StudioEvent.find({ productionId: production._id, userId: req.user._id }).sort({ _id: -1 }).limit(300).lean();
  const exports=await VideoExport.find({productionId:production._id,userId:req.user._id}).select("status progress error revision completedAt").sort({createdAt:-1}).limit(10).lean();
  const reserve=production.reservationId?await CreditReservation.findOne({_id:production.reservationId,userId:req.user._id}).select("credits remainingCredits status").lean():null;
  const remaining=reserve?.remainingCredits??reserve?.credits??0;
  const budget=reserve?{approved:reserve.credits,remaining,settled:production.steps.filter((s:any)=>s.charged).reduce((n:number,s:any)=>n+s.credits,0)+(exports.some((j:any)=>j.status==="completed")?Number(production.estimate.renderCredits||0):0),status:reserve.status}:null;
  res.json({ production, budget, exports, assets: assets.map(a => ({ ...a, url: undefined })), events: events.reverse() });
}));
studioRouter.get("/productions/:id/edit", wrap(async (req, res) => {
 const production = await own(req);
 const manual = (production.snapshot as any)?.manual ? await VideoEdit.findOne({userId:req.user._id,productionId:production._id}) : null;
 if (!production.timeline?.length && !manual) return res.status(409).json({ error: "Complete the production rough cut before editing." });
 const edit = manual || await ensureProductionEdit(production), timeline = edit.timeline;
 const ids = [...timeline.clips.map((c: any) => c.assetId), ...(timeline.overlays || []).map((o: any) => o.assetId), ...timeline.audio.map((a: any) => a.assetId)].filter(Boolean);
 res.json({ edit, assets: await MediaAsset.find({ _id: { $in: ids }, userId: req.user._id, deletedAt: null }).select("type durationSeconds metadata sceneId").lean() });
}));
studioRouter.post("/productions/:id/edit-command", wrap(async (req, res) => {
 const production = await own(req), input = z.object({ message: z.string().min(3).max(1000), revision: z.number().int().nonnegative() }).parse(req.body);
 if (!production.timeline?.length && !(production.snapshot as any)?.manual) return res.status(409).json({ error: "Complete the production rough cut before editing." });
 res.json(await applyProductionEdit(production, input.message, input.revision));
}));

studioRouter.post("/productions/:id/approve", wrap(async (req, res) => {
  const production = await own(req);
  const {maxCredits}=z.object({maxCredits:z.number().int().nonnegative().max(1000000)}).parse(req.body);
  const cards=await ensureProductionApprovals(String(req.user._id),String(production._id));
  const card=cards.approvals.find((a:any)=>a.scope==="production"&&a.status==="pending");
  if(!card){if(production.approvedAt)return res.json({production});fail(production.estimate.missingPricing?.length?"Pricing unavailable: "+production.estimate.missingPricing.join("; ")+". Select a supported priced model and refresh the estimate.":"Prepare a current production quote before approval");}
  if(maxCredits<card!.credits)fail("Spending limit is lower than the production estimate");
  await approveCreditCard(String(req.user._id),String(card!._id),card!.credits);
  res.json({production:await own(req)});
}));

studioRouter.post("/productions/:id/control", wrap(async (req, res) => {
  res.json({production:await controlProduction(String(req.user._id),idSchema.parse(req.params.id),req.body)});
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
