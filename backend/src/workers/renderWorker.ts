import mongoose from "mongoose";
import { env } from "../config/env.js";
import { RenderWorker, VideoExport } from "../models/VideoEdit.js";
import { renderCapabilities } from "../services/ffmpeg.js";
import { persistentStorageConfigured } from "../services/mediaStorage.js";
import { processVideoExport } from "../services/videoExport.js";

if (!env.MONGODB_URI || !env.RENDER_QUEUE_ENABLED || !persistentStorageConfigured()) throw new Error("Render worker requires MONGODB_URI, RENDER_QUEUE_ENABLED=true and private R2 storage");
const capabilities = await renderCapabilities();
await mongoose.connect(env.MONGODB_URI);
let stopping = false;
async function heartbeat() {
  await RenderWorker.updateOne({ _id: "ffmpeg" }, { $set: { expiresAt: new Date(Date.now() + 30000), capabilities } }, { upsert: true });
  await VideoExport.updateMany({ status: { $in: ["rendering", "uploading"] }, attempts: { $gte: 3 }, leaseUntil: { $lt: new Date() } }, { $set: { status: "failed", error: "Export interrupted repeatedly. Retry from the editor." }, $unset: { leaseUntil: 1, leaseToken: 1 } });
}
await heartbeat();
const timer = setInterval(() => { heartbeat().catch(error => console.warn("Render heartbeat:", error.message)); }, 10000);
console.log("Drex FFmpeg render worker ready");
process.once("SIGINT", () => { stopping = true; }); process.once("SIGTERM", () => { stopping = true; });
while (!stopping) {
  try { if (!await processVideoExport()) await new Promise(resolve => setTimeout(resolve, 1500)); }
  catch (error) { console.warn("Render worker will retry:", error); await new Promise(resolve => setTimeout(resolve, 3000)); }
}
clearInterval(timer); await mongoose.disconnect();
