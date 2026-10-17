import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { CreativeJob } from "../models/CreativeJob.js";
import { RenderWorker } from "../models/VideoEdit.js";
import { prepareShortClips } from "../services/shortClips.js";
import { persistentStorageConfigured, deleteImageObject } from "../services/mediaStorage.js";
import { settleReservation, releaseReservation } from "../services/wallet.js";
import { checkGenerationUser, assertProviderBudget } from "../services/platformControl.js";

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
    // Removed presenter jobs must never generate again. Preserve accepted work for reconciliation.
    await CreativeJob.updateMany({ kind: "avatar", status: { $in: ["uploading", "queued"] }, providerId: { $exists: false } }, { status: "cancelled", error: "Presenter creation was removed; unused reservations are released." });
    await CreativeJob.updateMany({ kind: "avatar", status: { $in: ["processing", "provider_pending", "queued"] } }, { status: "needs_review", error: "Presenter creation was removed. Reconcile accepted provider work before releasing credits." });
    // Reconcile durable terminal states if a process stopped between status and wallet writes.
    const completed = await CreativeJob.find({ status: "completed" }).select("reservationId").sort({ updatedAt: -1 }).limit(100);
    for (const entry of completed) await settleReservation(String(entry.reservationId));
    const cancelled = await CreativeJob.find({ status: { $in: ["cancelled", "failed"] } }).select("reservationId").sort({ updatedAt: -1 }).limit(100);
    for (const entry of cancelled) await releaseReservation(String(entry.reservationId), "creative_terminal_reconciliation");
    // Never automatically resubmit an interrupted billable provider operation.
    await CreativeJob.updateMany({ status: "processing", leaseUntil: { $lt: new Date() } }, { status: "needs_review", error: "Worker interrupted. Administrator review is required before any provider retry or credit release." });
    const abandoned = await CreativeJob.find({ status: "uploading", createdAt: { $lt: new Date(Date.now() - 3600000) } }).limit(20);
    for (const entry of abandoned) { const cancelled = await CreativeJob.findOneAndUpdate({ _id: entry._id, status: "uploading" }, { status: "cancelled", error: "Upload expired" }); if (cancelled) { await releaseReservation(String(entry.reservationId), "creative_upload_expired"); if (entry.sourceKey) await deleteImageObject(entry.sourceKey); } }
    job = await CreativeJob.findOneAndUpdate({ kind: "shorts", $or: [{ status: "queued" }, { status: "provider_pending", leaseUntil: { $lt: new Date() } }] }, { status: "processing", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) }, { new: true, sort: { createdAt: 1 } });
    if (!job) { await new Promise(r => setTimeout(r, 2000)); continue; }
    const token = job.leaseToken;
    const renew = setInterval(() => void CreativeJob.updateOne({ _id: job._id, leaseToken: token, status: "processing" }, { leaseUntil: new Date(Date.now() + 120000) }).catch(() => {}), 20000);
    try {
      await checkGenerationUser(String(job.userId)); await assertProviderBudget(job.quote.model, job.quote.estimatedCostUsd);
      const result = await prepareShortClips(job, async progress => { const updated = await CreativeJob.updateOne({ _id: job._id, leaseToken: token, status: "processing" }, { progress }); if (!updated.matchedCount) throw new Error("Creative job lease lost"); });
      await CreativeJob.updateOne({ _id: job._id, leaseToken: token, status: "processing" }, { status: "completed", progress: 100, result });
      await settleReservation(String(job.reservationId));
      if (job.sourceKey) await deleteImageObject(job.sourceKey).catch(() => {});
    } finally { clearInterval(renew); }
  } catch (e) {
    console.warn("Creative worker:", e instanceof Error ? e.message : "Processing failed");
    if (job) { await CreativeJob.updateOne({ _id: job._id, leaseToken: job.leaseToken }, { status: "failed", error: "Processing could not finish. Your reserved credits will be released. Review source and provider configuration before trying again." }); await releaseReservation(String(job.reservationId), "creative_failed").catch(() => {}); if (job.sourceKey) await deleteImageObject(job.sourceKey).catch(() => {}); }
    await new Promise(r => setTimeout(r, 2000));
  }
}
clearInterval(heartbeat); await RenderWorker.deleteOne({ _id: "creative" }); await mongoose.disconnect();
