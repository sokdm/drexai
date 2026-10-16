import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../config/env.js";
import { CreativeJob } from "../models/CreativeJob.js";
import { RenderWorker } from "../models/VideoEdit.js";
import { prepareShortClips } from "../services/shortClips.js";
import { avatarRequest, submitAvatar } from "../services/avatar.js";
import { persistentStorageConfigured, uploadVerifiedExport, deleteImageObject } from "../services/mediaStorage.js";
import { settleReservation, releaseReservation } from "../services/wallet.js";
import { checkGenerationUser, assertProviderBudget } from "../services/platformControl.js";
import { probeMedia } from "../services/ffmpeg.js";

if (!env.MONGODB_URI || !persistentStorageConfigured()) throw new Error("Creative worker requires MongoDB and private R2 storage");
await mongoose.connect(env.MONGODB_URI);
let stopping = false;
const heartbeat = setInterval(() => void RenderWorker.updateOne({ _id: "creative" }, { expiresAt: new Date(Date.now() + 30000) }, { upsert: true }).catch(() => {}), 10000);
await RenderWorker.updateOne({ _id: "creative" }, { expiresAt: new Date(Date.now() + 30000) }, { upsert: true });
process.once("SIGINT", () => { stopping = true; }); process.once("SIGTERM", () => { stopping = true; });
console.log("Drex creative worker ready");
while (!stopping) {
  let job: any;
  try {
    // Reconcile durable terminal states if a process stopped between status and wallet writes.
    const completed = await CreativeJob.find({ status: "completed" }).select("reservationId").sort({ updatedAt: -1 }).limit(100);
    for (const entry of completed) await settleReservation(String(entry.reservationId));
    const cancelled = await CreativeJob.find({ status: { $in: ["cancelled", "failed"] } }).select("reservationId").sort({ updatedAt: -1 }).limit(100);
    for (const entry of cancelled) await releaseReservation(String(entry.reservationId), "creative_terminal_reconciliation");
    // Never automatically resubmit an interrupted billable provider operation.
    await CreativeJob.updateMany({ status: "processing", leaseUntil: { $lt: new Date() } }, { status: "needs_review", error: "Worker interrupted. Administrator review is required before any provider retry or credit release." });
    const abandoned = await CreativeJob.find({ status: "uploading", createdAt: { $lt: new Date(Date.now() - 3600000) } }).limit(20);
    for (const entry of abandoned) { const cancelled = await CreativeJob.findOneAndUpdate({ _id: entry._id, status: "uploading" }, { status: "cancelled", error: "Upload expired" }); if (cancelled) { await releaseReservation(String(entry.reservationId), "creative_upload_expired"); if (entry.sourceKey) await deleteImageObject(entry.sourceKey); } }
    job = await CreativeJob.findOneAndUpdate({ $or: [{ status: "queued" }, { status: "provider_pending", leaseUntil: { $lt: new Date() } }] }, { status: "processing", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) }, { new: true, sort: { createdAt: 1 } });
    if (!job) { await new Promise(r => setTimeout(r, 2000)); continue; }
    const token = job.leaseToken;
    const renew = setInterval(() => void CreativeJob.updateOne({ _id: job._id, leaseToken: token, status: "processing" }, { leaseUntil: new Date(Date.now() + 120000) }).catch(() => {}), 20000);
    try {
      await checkGenerationUser(String(job.userId)); await assertProviderBudget(job.quote.model, job.quote.estimatedCostUsd);
      let result: any;
      if (job.kind === "shorts") result = await prepareShortClips(job, async progress => { const updated = await CreativeJob.updateOne({ _id: job._id, leaseToken: token, status: "processing" }, { progress }); if (!updated.matchedCount) throw new Error("Creative job lease lost"); });
      else {
        if (!job.providerId) {
          // Write intent before submission: a network ambiguity must never cause an automatic duplicate.
          await CreativeJob.updateOne({ _id: job._id, leaseToken: token }, { progress: 10 });
          try { job.providerId = await submitAvatar(job); }
          catch { await CreativeJob.updateOne({ _id: job._id, leaseToken: token }, { status: "needs_review", error: "Avatar submission was not confirmed. Check provider records before retrying or releasing reserved credits." }); continue; }
          await CreativeJob.updateOne({ _id: job._id, leaseToken: token }, { providerId: job.providerId });
        }
        const state = await avatarRequest("/v1/video_status.get?video_id=" + encodeURIComponent(job.providerId));
        if (state?.status === "failed") throw new Error("Avatar provider reported generation failure");
        if (state?.status !== "completed") { await CreativeJob.updateOne({ _id: job._id, leaseToken: token }, { status: "provider_pending", progress: 40, leaseUntil: new Date(Date.now() + 15000) }); continue; }
        const url = new URL(state.video_url);
        if (url.protocol !== "https:" || !["heygen.ai", "heygen.com"].some(h => url.hostname === h || url.hostname.endsWith("." + h))) throw new Error("Unsupported avatar media host");
        const directory = await mkdtemp(path.join(tmpdir(), "drex-avatar-"));
        try {
          const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(300000) });
          if (!response.ok || !response.body) throw new Error("Avatar output unavailable");
          let bytes = 0;
          const limit = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > 250 * 1024 * 1024 ? new Error("Avatar output exceeds 250 MB") : null, chunk); } });
          const file = path.join(directory, "avatar.mp4"); await pipeline(Readable.fromWeb(response.body as any), limit, createWriteStream(file));
          const info = await probeMedia(file); if (!info.video || !info.audio || !info.duration) throw new Error("Avatar output is not a playable talking video");
          result = { ...await uploadVerifiedExport(file, `${job.userId}/avatars/${job._id}.mp4`), duration: info.duration, width: info.width, height: info.height };
        } finally { await rm(directory, { recursive: true, force: true }); }
      }
      await CreativeJob.updateOne({ _id: job._id, leaseToken: token, status: "processing" }, { status: "completed", progress: 100, result });
      await settleReservation(String(job.reservationId));
      if (job.sourceKey) await deleteImageObject(job.sourceKey).catch(() => {});
    } finally { clearInterval(renew); }
  } catch (e) {
    console.warn("Creative worker:", e instanceof Error ? e.message : "Processing failed");
    if (job?.kind === "avatar" && job.providerId) { await CreativeJob.updateOne({ _id: job._id, leaseToken: job.leaseToken }, { status: "needs_review", error: "Provider work was accepted but completion could not be confirmed. Administrator reconciliation is required; no duplicate submission will be made." }); }
    else if (job) { await CreativeJob.updateOne({ _id: job._id, leaseToken: job.leaseToken }, { status: "failed", error: "Processing could not finish. Your reserved credits will be released. Review source and provider configuration before trying again." }); await releaseReservation(String(job.reservationId), "creative_failed").catch(() => {}); if (job.sourceKey) await deleteImageObject(job.sourceKey).catch(() => {}); }
    await new Promise(r => setTimeout(r, 2000));
  }
}
clearInterval(heartbeat); await RenderWorker.deleteOne({ _id: "creative" }); await mongoose.disconnect();
