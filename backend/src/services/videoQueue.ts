import { redisConnection } from "../services/redisConnection.js";
import { Queue } from "bullmq";
import { env } from "../config/env.js";

let videoQueue: Queue<{ jobId: string }> | undefined;

export async function enqueueVideoJob(jobId: string) {
  if (!env.IMAGE_QUEUE_ENABLED) return null;
  videoQueue ??= new Queue<{ jobId: string }>("video-generation", {
    connection: redisConnection(false),
    defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 }
  });
  return videoQueue.add("generate", { jobId }, { jobId });
}
