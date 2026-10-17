import mongoose from "mongoose";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { GenerationPriceRule } from "../models/GenerationPriceRule.js";
import { editingCommand } from "../services/editorCommands.js";
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
import { uploadImage, uploadVideo, persistentStorageConfigured, signedImageUrl, openMediaStream } from "../services/mediaStorage.js";
import { roughCut, validateTimelineAssets, editorFail, editorAssetUrl, uploadEditorAudio, editingSuggestions, captionsFromTranscript } from "../services/videoEditing.js";
import { env } from "../config/env.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { editorAssetBytes } from "../services/videoEditing.js";
import { probeMedia, renderTimeline, runMedia } from "../services/ffmpeg.js";
import { speechRanges, retainTimelineRanges } from "../services/silenceEditing.js";
import { withProvider } from "../services/platformControl.js";
import { measureWaveform } from "../services/waveform.js";

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
editorRouter.post("/blank", wrap(async(req,res)=>{
 const requestId=z.string().uuid().parse(req.body.requestId);
 const key=(kind:string)=>new mongoose.Types.ObjectId(createHash("sha256").update(String(req.user._id)+":"+requestId+":"+kind).digest("hex").slice(0,24));
 const editId=key("edit"), projectId=key("project"), productionId=key("production");
 let edit=await VideoEdit.findOne({_id:editId,userId:req.user._id});
 if(!edit){const session=await mongoose.startSession();try{await session.withTransaction(async()=>{
  edit=await VideoEdit.findOne({_id:editId,userId:req.user._id}).session(session);if(edit)return;
  await AIProject.create([{_id:projectId,userId:req.user._id,title:"Untitled video",type:"Manual edit",scenes:[],latestEditId:editId}],{session});
  await StudioProduction.create([{_id:productionId,userId:req.user._id,projectId,title:"Untitled video",status:"draft",snapshot:{title:"Untitled video",scenes:[],characters:[],manual:true},settings:{aspectRatio:"16:9"},estimate:{credits:0,missingPricing:[],images:0,audioSegments:0,maxClips:0,maxVideoSeconds:0},steps:[],timeline:[]}],{session});
  [edit]=await VideoEdit.create([{_id:editId,userId:req.user._id,projectId,productionId,title:"Untitled video",timeline:{clips:[],audio:[],captions:[],aspectRatio:"16:9",musicDecision:"none"},revision:0}],{session});
 });}finally{await session.endSession();}}
 res.status(201).json({edit});
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
  const referenced = [...edit.timeline.clips.map((c: any) => c.assetId), ...(edit.timeline.overlays || []).map((o: any) => o.assetId), ...edit.timeline.audio.map((a: any) => a.assetId)].filter(Boolean);
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
editorRouter.post("/edits/:id/command", rateLimit({ windowMs: 60000, limit: 6 }), wrap(async (req, res) => {
 const edit = await own(req), input = z.object({ message: z.string().min(3).max(1000), timeline: timelineSchema, revision: z.number().int().nonnegative() }).parse(req.body);
 if (input.revision !== edit.revision) editorFail("This edit changed in another tab. Reload before applying a command.", 409);
 const assets = await validateTimelineAssets(input.timeline, String(req.user._id));
 const result = /silent|silence/i.test(input.message) ? await withProvider("ffmpeg", async () => {
   await checkGenerationUser(String(req.user._id));
   const total = input.timeline.clips.reduce((n, c) => n + c.duration, 0);
   if (!total || total > 300) editorFail("Silence analysis currently supports edits up to five minutes. Split longer edits first.");
   const directory = await mkdtemp(path.join(tmpdir(), "drex-silence-"));
   try {
     const sources = new Map<string, string>();
     let sourceBytes = 0;
     for (const asset of assets) {
       if ((asset.sizeBytes || 0) > 250 * 1024 * 1024) editorFail("Source exceeds the silence analysis size limit");
       const bytes = await editorAssetBytes(asset); sourceBytes += bytes.length;
       if (bytes.length > 250 * 1024 * 1024 || sourceBytes > 500 * 1024 * 1024) editorFail("Sources exceed the silence analysis size limit");
       const file = path.join(directory, String(asset._id)); await writeFile(file, bytes); sources.set(String(asset._id), file);
     }
     const rendered = await renderTimeline(input.timeline, { format: "mp4", resolution: "480p", quality: "draft", filename: "silence-analysis" }, sources, directory);
     const log = await runMedia("ffmpeg", ["-hide_banner", "-nostdin", "-i", rendered.file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-"], { includeStderr: true, stderrLimit: 2 * 1024 * 1024 });
     const ranges = speechRanges(log, total), timeline = retainTimelineRanges(input.timeline, ranges);
     return { timeline, explanation: `Removed ${(total - timeline.clips.reduce((n, c) => n + c.duration, 0)).toFixed(2)} seconds below -35 dB lasting at least 0.6 seconds, preserving 0.12-second handles. All audio and captions were cut with the video. Music can mask silence; review and undo if needed.` };
   } finally { await rm(directory, { recursive: true, force: true }); }
 }) : editingCommand(input.timeline, input.message, captionsFromTranscript(input.timeline, assets));
 await validateTimelineAssets(result.timeline, String(req.user._id));
 // Return a revision-bound proposal; the existing undo/save workflow owns commit.
 res.json({ ...result, revision: edit.revision, note: "Applied to the editor preview. Undo or save this change using the existing timeline controls. No AI provider request or credit charge was made." });
}));
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
editorRouter.post("/assets/:assetId/waveform", rateLimit({ windowMs: 60000, limit: 6 }), wrap(async (req, res) => {
 const asset = await MediaAsset.findOne({ _id: idSchema.parse(req.params.assetId), userId: req.user._id, deletedAt: null, type: { $in: ["audio", "video"] } });
 if (!asset) return res.status(404).json({ error: "Audio source not found" });
 if (asset.metadata?.waveform) return res.json(asset.metadata.waveform);
 const waveform = await withProvider("ffmpeg", () => measureWaveform(asset));
 await MediaAsset.updateOne({ _id: asset._id, userId: req.user._id }, { $set: { "metadata.waveform": waveform } });
 res.json(waveform);
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

editorRouter.post("/edits/:id/visual", raw({type:["image/png","image/jpeg","image/webp","video/mp4","video/webm"],limit:"100mb"}),wrap(async(req,res)=>{
 const edit=await own(req);if(!persistentStorageConfigured())editorFail("Configure private R2 storage before uploading visuals",503);
 if(!Buffer.isBuffer(req.body)||!req.body.length)editorFail("Upload a PNG, JPEG, WebP, MP4 or WebM file");
 if(req.headers["x-license-confirmed"]!=="true")editorFail("Confirm permission to use this media");
 const name=String(req.headers["x-file-name"]||"Uploaded visual").slice(0,150), contentType=String(req.headers["content-type"]||"");
 let asset:any;
 if(contentType.startsWith("image/")){
  if(req.body.length>15*1024*1024)editorFail("Images must be 15MB or smaller");
  const bytes=await sharp(req.body,{limitInputPixels:16000000}).rotate().png().toBuffer(),info=await sharp(bytes).metadata();
  const stored=await uploadImage(bytes,String(req.user._id)+"/editor/"+randomUUID()+".png");
  asset=await MediaAsset.create({userId:req.user._id,projectId:edit.projectId,provider:"upload",type:"image",...stored,width:info.width,height:info.height,sizeBytes:bytes.length,contentType:"image/png",metadata:{name,licenseConfirmed:true}});
 }else{
  const directory=await mkdtemp(path.join(tmpdir(),"drex-upload-"));
  try{const file=path.join(directory,"source");await writeFile(file,req.body);const info=await probeMedia(file);
   if(!info.video||!info.duration||info.duration>3600||info.width>7680||info.height>7680)editorFail("Upload a readable video up to one hour and 7680 pixels per side");
   const stored=await uploadVideo(req.body,String(req.user._id)+"/editor/"+randomUUID(),contentType);
   asset=await MediaAsset.create({userId:req.user._id,projectId:edit.projectId,provider:"upload",type:"video",...stored,width:info.width,height:info.height,durationSeconds:info.duration,sizeBytes:req.body.length,contentType,metadata:{name,licenseConfirmed:true}});
  }finally{await rm(directory,{recursive:true,force:true});}
 }
 res.status(201).json({asset:publicAsset(asset.toObject())});
}));
