import {StudioEvent} from "../models/StudioProduction.js";
import {settleStudioStep,closeStudioReserve} from "./studioBilling.js";
import { withProvider,checkGenerationUser } from "./platformControl.js";
import { settleReservation, releaseReservation } from "./wallet.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { timelineSchema, exportSettingsSchema, outputDimensions } from "@drex/shared";
import { VideoExport } from "../models/VideoEdit.js";
import { validateTimelineAssets, editorAssetBytes } from "./videoEditing.js";
import { probeMedia, renderTimeline } from "./ffmpeg.js";
import { uploadVerifiedExport } from "./mediaStorage.js";

type Storage = { read: typeof editorAssetBytes; upload: typeof uploadVerifiedExport };
export async function processVideoExport(id?: string, storage: Storage = { read: editorAssetBytes, upload: uploadVerifiedExport }) {
  const token = randomUUID(), now = new Date();
  const job: any = await VideoExport.findOneAndUpdate({ ...(id ? { _id: id } : {}), attempts: { $lt: 3 }, $or: [{ status: "queued" }, { status: { $in: ["rendering", "uploading"] }, leaseUntil: { $lt: now } }] }, { $set: { status: "rendering", leaseToken: token, leaseUntil: new Date(Date.now() + 60000), error: "", progress: 1 }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
  if (!job) return false;
  const activity=async(level:string,message:string)=>{if(job.productionId)await StudioEvent.create({productionId:job.productionId,userId:job.userId,level,message,stepKey:"final-render"});};
  await activity("processing","FFmpeg is rendering the saved shared timeline to MP4.");
  const controller = new AbortController(); let renewing = false;
  const timer = setInterval(async () => {
    if (renewing) return; renewing = true;
    try { const result = await VideoExport.updateOne({ _id: job._id, leaseToken: token, status: { $in: ["rendering", "uploading"] } }, { $set: { leaseUntil: new Date(Date.now() + 60000) } }); if (!result.modifiedCount) controller.abort(); }
    catch { controller.abort(); } finally { renewing = false; }
  }, 10000);
  const dir = await mkdtemp(path.join(tmpdir(), "drex-render-"));
  try {
    await checkGenerationUser(String(job.userId));
    const timeline = timelineSchema.parse(job.timeline), settings = exportSettingsSchema.parse(job.settings);
    const assets = await validateTimelineAssets(timeline, String(job.userId), settings), sources = new Map<string, string>();
    for (const asset of assets) {
      if ((asset.sizeBytes || 0) > 250 * 1024 * 1024) throw new Error("Source media exceeds render limit (250 MB per asset)");
      const bytes = await storage.read(asset);
      if (bytes.length > 250 * 1024 * 1024) throw new Error("Source media is too large");
      const file = path.join(dir, `source-${asset._id}`); await writeFile(file, bytes); sources.set(String(asset._id), file);
      const info = await probeMedia(file);
      if (asset.type === "audio" && !info.audio) throw new Error("Unreadable audio source");
      if (asset.type !== "audio" && !info.video) throw new Error("Unreadable visual source");
      for (const clip of timeline.clips.filter(c => c.assetId === String(asset._id))) {
        if (clip.kind === "video" && clip.sourceIn + clip.duration * (clip.speed ?? 1) > info.duration + 0.05) throw new Error(`Clip exceeds actual source duration: ${clip.label}`);
        // Standard FFmpeg scaling supports mixed-resolution sources; no AI upscaling.
      }
      for (const overlay of (timeline.overlays || []).filter(o => o.assetId === String(asset._id))) if (overlay.kind === "video" && overlay.sourceIn + overlay.duration > info.duration + .05) throw new Error("Overlay exceeds actual source duration");
      for (const audio of timeline.audio.filter(a => a.assetId === String(asset._id))) if (audio.sourceIn + audio.duration > info.duration + 0.05) throw new Error(`Audio exceeds actual source duration: ${audio.label}`);
    }
    let lastProgress = 0;
    const rendered = await withProvider("ffmpeg", () => renderTimeline(timeline, settings, sources, dir, progress => {
      if (!Number.isFinite(progress) || progress - lastProgress < 2) return; lastProgress = progress;
      void VideoExport.updateOne({ _id: job._id, leaseToken: token }, { $max: { progress: Math.floor(progress) } }).catch(() => controller.abort());
    }, controller.signal));
    if (controller.signal.aborted) throw new Error("Render lease lost; another worker will recover this export");
    const uploading = await VideoExport.updateOne({ _id: job._id, leaseToken: token }, { $set: { status: "uploading", progress: 94 } });
    if (!uploading.modifiedCount) throw new Error("Render lease lost");
    const stored = await storage.upload(rendered.file, `${job.userId}/exports/${job._id}/${token}.mp4`);
    if (controller.signal.aborted) throw new Error("Render lease lost during upload");
    await VideoExport.updateOne({ _id: job._id, leaseToken: token }, { $set: { status: "completed", progress: 100, ...stored, duration: rendered.duration, width: rendered.width, height: rendered.height, completedAt: new Date() }, $unset: { leaseToken: 1, leaseUntil: 1 } });
    if(job.productionId&&job.reservationId){await settleStudioStep(String(job.reservationId),"final-render",job.budgetCredits||0,{exportId:String(job._id),productionId:String(job.productionId)});await closeStudioReserve(String(job.reservationId),"production_render_complete");}
    else if (job.reservationId) await settleReservation(String(job.reservationId));
    await activity("success","MP4 rendered, verified and saved to project storage. Ready to download.");
  } catch (error) {
    if(job.productionId&&job.reservationId)await closeStudioReserve(String(job.reservationId),"production_render_failed");
    else if (job.reservationId) await releaseReservation(String(job.reservationId), "render_failed");
    await activity("failure",error instanceof Error?error.message:"Export failed");
    await VideoExport.updateOne({ _id: job._id, leaseToken: token }, { $set: { status: "failed", error: error instanceof Error ? error.message.slice(0, 2500) : "Export failed" }, $unset: { leaseToken: 1, leaseUntil: 1 } });
  } finally { clearInterval(timer); await rm(dir, { recursive: true, force: true }); }
  return true;
}
