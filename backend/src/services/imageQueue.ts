import { redisConnection } from "../services/redisConnection.js";
import { Queue } from "bullmq";
import { env } from "../config/env.js";

export type ImageJobPayload = { jobId: string };

let imageQueue: Queue<ImageJobPayload> | undefined;
function getImageQueue() {
return imageQueue ??= new Queue<ImageJobPayload>("image-generation", {
  connection: redisConnection(false),
  defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: 100, removeOnFail: 100 }
});
}

export async function enqueueImageJob(jobId: string) {
  if (!env.IMAGE_QUEUE_ENABLED) return null;
  return getImageQueue().add("generate", { jobId }, { jobId });
}
