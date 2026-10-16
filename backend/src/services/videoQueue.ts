import { requireQueueWorker } from "./queueReadiness.js";
import { redisConnection } from "../services/redisConnection.js";
import { Queue } from "bullmq";
import { env } from "../config/env.js";

let videoQueue: Queue<{ jobId: string }> | undefined;

export function getVideoQueue() {
  if (videoQueue) return videoQueue;
  videoQueue ??= new Queue<{ jobId: string }>("video-generation", {
    connection: redisConnection(false),
    defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 }
  });
  videoQueue.on("error", () => {}); return videoQueue;
}

export async function assertVideoQueueReady() { if (env.IMAGE_QUEUE_ENABLED) await requireQueueWorker(getVideoQueue()); }
export async function enqueueVideoJob(jobId: string) { if (!env.IMAGE_QUEUE_ENABLED) return null; return getVideoQueue().add("generate", { jobId }, { jobId }); }
