import { requireQueueWorker } from "./queueReadiness.js";
import { redisConnection } from "../services/redisConnection.js";
import { Queue } from "bullmq";
import { env } from "../config/env.js";

export type ImageJobPayload = { jobId: string };

let imageQueue: Queue<ImageJobPayload> | undefined;
export function getImageQueue() {
if (imageQueue) return imageQueue;
imageQueue = new Queue<ImageJobPayload>("image-generation", {
  connection: redisConnection(false),
  defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: 100, removeOnFail: 100 }
});
imageQueue.on("error", () => {});
return imageQueue;
}

export async function enqueueImageJob(jobId: string) {
  if (!env.IMAGE_QUEUE_ENABLED) return null;
  return getImageQueue().add("generate", { jobId }, { jobId });
}

export async function assertImageQueueReady() { if (env.IMAGE_QUEUE_ENABLED) await requireQueueWorker(getImageQueue()); }
