import { redisConnection } from "../services/redisConnection.js";
import { Worker } from "bullmq";
import "../config/env.js";
import { env } from "../config/env.js";
import { connectDatabase } from "../config/db.js";
import { processImageJob } from "../workers/processImageJob.js";

await connectDatabase();

new Worker("image-generation", async (job) => processImageJob(job.data.jobId), {
  connection: redisConnection(true)
});

console.log("Drex image worker listening");
