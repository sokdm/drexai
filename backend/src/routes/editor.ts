import { GenerationPriceRule } from "../models/GenerationPriceRule.js";
import { createQuote, reserveCredits, releaseReservation } from "../services/wallet.js";
import { rememberQuote, approvedTerms } from "../services/managedPricing.js";
import { checkGenerationUser, assertProviderBudget } from "../services/platformControl.js";
import { Router, raw, Request, Response, NextFunction } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { timelineSchema, exportSettingsSchema } from "@drex/shared";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { VideoEdit, VideoExport, RenderWorker } from "../models/VideoEdit.js";
import { StudioProduction } from "../models/StudioProduction.js";
import { AIProject } from "../models/AIProject.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { persistentStorageConfigured, signedImageUrl, openMediaStream } from "../services/mediaStorage.js";
import { roughCut, validateTimelineAssets, editorFail, editorAssetUrl, uploadEditorAudio, editingSuggestions, captionsFromTranscript } from "../services/videoEditing.js";
import { env } from "../config/env.js";

export const editorRouter = Router();
editorRouter.use(requireAuth, requireCsrf, rateLimit({ windowMs: 60000, limit: 180, standardHeaders: true, legacyHeaders: false }));
const idSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
async function own(req: Request) { const edit = await VideoEdit.findOne({ _id: idSchema.parse(req.params.id), userId: req.user._id }); if (!edit) editorFail("Edit not found", 404); return edit!; }
async function ownExport(req: Request) { const job = await VideoExport.findOne({ _id: idSchema.parse(req.params.exportId), userId: req.user._id }); if (!job) editorFail("Export not found", 404); return job!; }
function publicAsset(asset: any) { return { _id: asset._id, type: asset.type, width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds, prompt: asset.prompt, sceneId: asset.sceneId, metadata: asset.metadata }; }
async function readiness() {
  const worker = await RenderWorker.findOne({ _id: "ffmpeg", expiresAt: { $gt: new Date() } }).lean();
  return { queueEnabled: env.RENDER_QUEUE_ENABLED, storageConfigured: persistentStorageConfigured(), workerOnline: Boolean(worker), capabilities: worker?.capabilities ?? { resolutions: ["480p", "720p", "1080p"], formats: ["mp4"] } };
}
editorRouter.get("/config", wrap(async (req, res) => {
  const productions = await StudioProduction.find({ userId: req.user._id, "timeline.0": { $exists: true } }).select("title status projectId createdAt").sort({ updatedAt: -1 }).limit(100).lean();
  const edits = await VideoEdit.find({ userId: req.user._id }).select("title productionId projectId revision updatedAt").sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ productions, edits, readiness: await readiness() });
}));
editorRouter.post("/edits", wrap(async (req, res) => {
  const { productionId } = z.object({ productionId: idSchema }).parse(req.body);
  let edit = await VideoEdit.findOne({ userId: req.user._id, productionId });
  if (!edit) {
    const production = await StudioProduction.findOne({ _id: productionId, userId: req.user._id }).lean();
    if (!production) editorFail("Production not found", 404);
    const timeline = roughCut(production); await validateTimelineAssets(timeline, String(req.user._id));
    edit = await VideoEdit.findOneAndUpdate({ userId: req.user._id, productionId }, { $setOnInsert: { userId: req.user._id, productionId, projectId: production!.projectId, title: production!.title || "Untitled edit", timeline, revision: 0 } }, { upsert: true, new: true });
  }
  await AIProject.updateOne({ _id: edit!.projectId, userId: req.user._id }, { $set: { latestEditId: edit!._id } });
  res.status(201).json({ edit });
}));
editorRouter.get("/edits/:id", wrap(async (req, res) => {
  const edit = await own(req);
  const assets = await MediaAsset.find({ userId: req.user._id, deletedAt: null, $or: [{ projectId: edit.projectId }, { projectId: { $exists: false } }, { productionId: edit.productionId }] }).sort({ createdAt: -1 }).limit(500).lean();
  // Include every timeline asset even when it was reused from a different production.
  const referenced = [...edit.timeline.clips.map((c: any) => c.assetId), ...edit.timeline.audio.map((a: any) => a.assetId)].filter(Boolean);
  const missing = await MediaAsset.find({ _id: { $in: referenced.filter((id: string) => !assets.some(a => String(a._id) === id)) }, userId: req.user._id, deletedAt: null }).lean();
  const exports = await VideoExport.find({ editId: edit._id, userId: req.user._id }).select("-timeline -leaseToken").sort({ createdAt: -1 }).limit(20).lean();
  res.json({ edit, assets: [...assets, ...missing].map(publicAsset), exports, readiness: await readiness() });
}));
editorRouter.put("/edits/:id", wrap(async (req, res) => {
  const edit = await own(req);
  const input = z.object({ revision: z.number().int().nonnegative(), title: z.string().trim().min(1).max(150), timeline: timelineSchema }).parse(req.body);
  await validateTimelineAssets(input.timeline, String(req.user._id));
  const updated = await VideoEdit.findOneAndUpdate({ _id: edit._id, userId: req.user._id, revision: input.revision }, { $set: { title: input.title, timeline: input.timeline }, $inc: { revision: 1 } }, { new: true });
  if (!updated) editorFail("This edit changed in another tab. Reload before saving to avoid overwriting it.", 409);
  await AIProject.updateOne({ _id: edit.projectId, userId: req.user._id }, { $set: { latestEditId: edit._id } });
  res.json({ edit: updated });
}));
editorRouter.post("/edits/:id/suggestions", wrap(async (req, res) => { await own(req); const timeline = timelineSchema.parse(req.body.timeline); res.json({ suggestions: editingSuggestions(timeline), note: "Rule-based editing recommendations; review before applying." }); }));
editorRouter.post("/edits/:id/captions", wrap(async (req, res) => { await own(req); const timeline = timelineSchema.parse(req.body.timeline); const assets = await validateTimelineAssets(timeline, String(req.user._id)); res.json({ captions: captionsFromTranscript(timeline, assets), note: "Phrase timing is estimated. Native dialogue captions require a user-reviewed actual audio transcript; intended script text is not treated as verified speech. Review timing before export." }); }));
editorRouter.post("/edits/:id/audio", raw({ type: ["audio/*", "application/octet-stream"], limit: "100mb" }), wrap(async (req, res) => {
  const edit = await own(req), role = z.enum(["music", "sfx", "narration", "dialogue"]).parse(req.query.role);
  const name = decodeURIComponent(String(req.headers["x-file-name"] || "Uploaded audio"));
  const asset = await uploadEditorAudio(String(req.user._id), String(edit.projectId), req.body, name, String(req.headers["content-type"] || "audio/mpeg"), role, req.headers["x-license-confirmed"] === "true");
  res.status(201).json({ asset: publicAsset(asset.toObject()) });
}));
editorRouter.get("/assets/:assetId/url", wrap(async (req, res) => {
  const asset = await MediaAsset.findOne({ _id: idSchema.parse(req.params.assetId), userId: req.user._id, deletedAt: null });
  if (!asset) editorFail("Asset not found", 404); const url = await editorAssetUrl(asset); if (!url) editorFail("Media unavailable", 503); res.json({ url });
}));
editorRouter.post("/edits/:id/export-quote", wrap(async (req, res) => { const edit = await own(req); const duration = (edit.timeline.clips || []).reduce((n: number, c: any) => n + c.duration, 0); const rule = await GenerationPriceRule.findOne({ feature: "final_rendering", provider: "ffmpeg", model: "ffmpeg", active: true }); const terms = rule ? await createQuote({ feature: "final_rendering", provider: "ffmpeg", model: "ffmpeg", unit: "minute", quantity: Math.max(1, duration / 60) }) : { allowed: true, credits: 0, feature: "final_rendering", provider: "ffmpeg", model: "ffmpeg", estimatedCostUsd: null }; res.json({ quote: await rememberQuote(req.user._id, { editId: String(edit._id), revision: edit.revision, settings: req.body.settings }, terms) }); }));
editorRouter.post("/edits/:id/exports", rateLimit({ windowMs: 60000, limit: 5 }), wrap(async (req, res) => {
  const edit = await own(req), input = z.object({ revision: z.number().int().nonnegative(), settings: exportSettingsSchema, approvedCredits: z.number().int().nonnegative().optional() }).parse(req.body);
  if (input.revision !== edit.revision) editorFail("Save your current timeline before exporting", 409);
  const ready = await readiness();
  if (!ready.queueEnabled || !ready.storageConfigured || !ready.workerOnline) editorFail("Configure R2, enable rendering and start the FFmpeg worker before exporting", 503);
  const timeline = timelineSchema.parse(edit.timeline); if (!timeline.clips.length) editorFail("Add a clip before exporting");
  await validateTimelineAssets(timeline, String(req.user._id), input.settings);
  const active = await VideoExport.countDocuments({ userId: req.user._id, status: { $in: ["queued", "rendering", "uploading"] } });
  if (active >= 3) editorFail("Wait for an active export to finish", 429);
  await checkGenerationUser(String(req.user._id));
  const terms = await approvedTerms(req.user._id, { editId: String(edit._id), revision: edit.revision, settings: input.settings }, input.approvedCredits ?? 0, async () => { const rule = await GenerationPriceRule.findOne({ feature: "final_rendering", provider: "ffmpeg", model: "ffmpeg", active: true }); if (rule) throw new Error("Review the rendering quote before exporting."); return { credits: 0, feature: "final_rendering", model: "ffmpeg", provider: "ffmpeg" }; });
  if (terms.credits !== (input.approvedCredits ?? 0)) throw new Error("Approve the rendering cost first.");
  await assertProviderBudget("ffmpeg", terms.estimatedCostUsd);
  const reservation = terms.credits ? await reserveCredits(String(req.user._id), terms, `render:${edit._id}:${Date.now()}`) : null;
  let job; try { job = await VideoExport.create({ reservationId: reservation?._id, userId: req.user._id, editId: edit._id, projectId: edit.projectId, revision: edit.revision, timeline, settings: input.settings }); } catch (e) { if (reservation) await releaseReservation(String(reservation._id), "export_setup_failed"); throw e; }
  res.status(202).json({ export: job });
}));
editorRouter.get("/exports/:exportId", wrap(async (req, res) => { const job = await ownExport(req); const data = job.toObject() as any; delete data.timeline; delete data.leaseToken; if (job.status === "completed") data.url = await signedImageUrl(job.key!); res.json({ export: data }); }));
editorRouter.get("/exports/:exportId/download", wrap(async (req, res) => {
  const job = await ownExport(req); if (job.status !== "completed" || !job.key) editorFail("Export is not ready", 409);
  const object = await openMediaStream(job.key!); if (!object.Body) editorFail("Export file is unavailable", 404);
  const name = job.settings.filename.replace(/\.mp4$/i, "") + ".mp4";
  res.set({ "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" });
  if (object.ContentLength) res.setHeader("Content-Length", object.ContentLength);
  await pipeline(object.Body as Readable, res);
}));
editorRouter.post("/exports/:exportId/save", wrap(async (req, res) => {
  const job = await ownExport(req); if (job.status !== "completed") editorFail("Export is not ready", 409);
  await AIProject.updateOne({ _id: job.projectId, userId: req.user._id }, { $set: { finalExportId: job._id, latestEditId: job.editId } });
  job.savedToProjectAt = new Date(); await job.save(); res.json({ export: job });
}));
