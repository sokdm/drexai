import { redisConnection } from "../services/redisConnection.js";
import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { connectDatabase } from "../config/db.js";
import { processVideoJob } from "./processVideoJob.js";

await connectDatabase();

new Worker("video-generation", async (job) => processVideoJob(job.data.jobId), { connection: redisConnection(true) });

console.log("Drex video worker listening");
