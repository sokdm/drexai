import { ImageGenerationJob } from "../models/ImageGenerationJob.js";
import { VideoGenerationJob } from "../models/VideoGenerationJob.js";
import { assertImageQueueReady, enqueueImageJob } from "./imageQueue.js";
import { assertVideoQueueReady, enqueueVideoJob } from "./videoQueue.js";
import { processImageJob } from "../workers/processImageJob.js";
import { processVideoJob } from "../workers/processVideoJob.js";
import type { Model } from "mongoose";

const models: Record<"image" | "video", Model<any>> = { image: ImageGenerationJob, video: VideoGenerationJob };
export async function dispatchGeneration(kind: "image" | "video", id: string, dependencies = {
 ready: kind === "image" ? assertImageQueueReady : assertVideoQueueReady,
 enqueue: kind === "image" ? enqueueImageJob : enqueueVideoJob
}) {
 try { await dependencies.ready(); if (await dependencies.enqueue(id)) return "redis"; } catch { /* Persisted work remains eligible for Mongo execution. */ }
 await models[kind].updateOne({ _id: id, status: "queued" }, { $set: { dispatchMode: "mongo" } });
 return "mongo";
}
let ticking = false;
export async function runMongoGenerationTick(processors = { image: processImageJob, video: processVideoJob }) {
 if (ticking) return; ticking = true;
 try {
  // One web-service fallback job at a time. The worker's atomic status claim also
  // protects against another web replica or a delayed Redis delivery.
  for (const kind of ["image", "video"] as const) {
   const job = await models[kind].findOne({ status: "queued", $or: [{ dispatchMode: "mongo" }, { createdAt: { $lt: new Date(Date.now() - 60000) } }] }).sort({ createdAt: 1 }).select("_id");
   if (job) { await processors[kind](String(job._id)).catch(() => {}); break; }
  }
 } finally { ticking = false; }
}
export function startMongoGenerationFallback() {
 const timer = setInterval(() => void runMongoGenerationTick().catch(() => {}), 5000); timer.unref();
}
