import { redisConnection } from "./redisConnection.js";
import { Queue } from "bullmq";
import { env } from "../config/env.js";
import { StudioProduction } from "../models/StudioProduction.js";

export const studioRedisConnection = () => redisConnection(true);
let queue: Queue | undefined;
export function getStudioQueue() {
  if (!env.STUDIO_QUEUE_ENABLED) throw new Error("Studio worker is not enabled. Configure Redis and STUDIO_QUEUE_ENABLED first.");
  if (!queue) {
    queue = new Queue("studio-production", { connection: studioRedisConnection(), defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } });
    queue.on("error", () => console.warn("Studio queue connection unavailable"));
  }
  return queue;
}
export async function enqueueStudio(production: any) {
  return getStudioQueue().add("produce", { productionId: String(production._id) }, { jobId: `${production._id}-r${production.queueRevision}` });
}
export async function studioWorkerOnline() {
  if (!env.STUDIO_QUEUE_ENABLED) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getStudioQueue().client.then(client => client.get("drex:studio:worker-alive")).then(Boolean),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2500); })
    ]);
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
}

// MongoDB is the outbox: work survives a crash between saving approval and enqueueing.
export async function reconcileStudioQueue() {
  const queue = getStudioQueue();
  const productions = await StudioProduction.find({ status: { $in: ["queued", "running", "awaiting_credit_execution", "executing_approval"] }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }).limit(100);
  for (const production of productions) {
    const jobId = `${production._id}-r${production.queueRevision}`;
    const old = await queue.getJob(jobId);
    if (old) {
      const state = await old.getState();
      if (state === "active" || state === "waiting" || state === "delayed") continue;
      await old.remove();
    }
    await enqueueStudio(production);
  }
}
