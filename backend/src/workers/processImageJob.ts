import { ImageGenerationJob } from "../models/ImageGenerationJob.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { generateGeminiImages } from "../services/imageGeneration.js";
import { uploadImage } from "../services/mediaStorage.js";
import { releaseReservation, settleReservation } from "../services/wallet.js";

export async function processImageJob(jobId: string) {
  const job = await ImageGenerationJob.findOneAndUpdate({ _id: jobId, status: { $in: ["queued", "retrying"] } }, { $set: { status: "processing" }, $inc: { attempts: 1 } }, { new: true });
  if (!job) return;
  try {
    job.status = "processing";
    await job.save();
    const outputs = await generateGeminiImages(job.toObject());
    const assets = [];
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      const key = `${job.userId}/images/${job._id}-${index}.${output.contentType === "image/jpeg" ? "jpg" : "png"}`;
      const stored = await uploadImage(output.buffer, key, output.contentType);
      assets.push(await MediaAsset.create({ userId: job.userId, projectId: job.projectId, jobId: job._id, prompt: job.prompt, provider: job.provider, model: job.model, key: stored.key, bucket: stored.bucket, url: stored.url, contentType: output.contentType, sizeBytes: output.buffer.length, metadata: { stylePreset: job.stylePreset, aspectRatio: job.aspectRatio, resolution: job.resolution } }));
    }
    job.status = "completed";
    job.outputMetadata = { assetIds: assets.map((asset) => asset._id), count: assets.length };
    job.completedAt = new Date();
    await job.save();
    if (job.reservationId) await settleReservation(String(job.reservationId));
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Image generation failed";
    await job.save();
    if (job.reservationId) await releaseReservation(String(job.reservationId), "image_generation_failed");
    throw error;
  }
}
