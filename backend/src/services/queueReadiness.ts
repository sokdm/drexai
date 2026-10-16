import type { Queue } from "bullmq";
export async function requireQueueWorker(queue: Queue) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const workers = await Promise.race([
      queue.getWorkers(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Queue connection timed out")), 6000); })
    ]);
    if (!workers.length) throw new Error("Worker not started");
  } catch {
    throw Object.assign(new Error("Generation queue is unavailable. Configure the real Redis URL and start the matching image/video background worker in Render before generating."), { statusCode: 503 });
  } finally { if (timer) clearTimeout(timer); }
}
