import { assertMediaWorkerConfig } from "../services/mediaWorkerConfig.js";
import { redisConnection } from "../services/redisConnection.js";
import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { connectDatabase } from "../config/db.js";
import { processVideoJob } from "./processVideoJob.js";

assertMediaWorkerConfig(env);
await connectDatabase();

const worker = new Worker("video-generation", async (job) => processVideoJob(job.data.jobId), { connection: redisConnection(true) });

worker.on("error", () => console.warn("video worker Redis connection unavailable; check this worker's REDIS_URL and region."));
await worker.waitUntilReady();
console.log("Drex video worker listening; MongoDB and Redis connections established");
async function shutdown() { await worker.close(); const mongoose = await import("mongoose"); await mongoose.default.disconnect(); }
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
