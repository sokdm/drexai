import { Worker } from "bullmq";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { getStudioQueue, reconcileStudioQueue, studioRedisConnection } from "../services/studioQueue.js";
import { runStudioProduction } from "../services/studioExecution.js";
import { persistentStorageConfigured } from "../services/mediaStorage.js";

if (!env.MONGODB_URI || !env.STUDIO_QUEUE_ENABLED || !persistentStorageConfigured() || !env.GEMINI_API_KEY) throw new Error("Studio requires MongoDB, Redis, Gemini, and private R2 storage configuration.");
await mongoose.connect(env.MONGODB_URI);
const queue = getStudioQueue();
const client = await queue.client;
const worker = new Worker("studio-production", async job => runStudioProduction(job.data.productionId), { connection: studioRedisConnection(), concurrency: 2, lockDuration: 60000, maxStalledCount: 2 });
worker.on("error", () => console.warn("Studio worker connection error"));
worker.on("failed", (_job, error) => console.warn("Studio job needs recovery:", error.message));
async function maintain() {
  await client.set("drex:studio:worker-alive", "1", { EX: 30 });
  await reconcileStudioQueue();
}
await maintain();
const timer = setInterval(() => { maintain().catch(() => console.warn("Studio recovery sweep will retry")); }, 10000);
console.log("Drex Studio worker ready");
async function shutdown() { clearInterval(timer); await worker.close(); await queue.close(); await mongoose.disconnect(); }
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
