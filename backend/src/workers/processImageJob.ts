import { CreditReservation } from "../models/CreditReservation.js";
import { ImageGenerationJob } from "../models/ImageGenerationJob.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { generateGeminiImages } from "../services/imageGeneration.js";
import { uploadImage } from "../services/mediaStorage.js";
import { releaseReservation, settleReservation } from "../services/wallet.js";
import { imageReferences } from "../services/imageReferences.js";

export async function processImageJob(jobId: string) {
  const job = await ImageGenerationJob.findOneAndUpdate({ _id: jobId, status: { $in: ["queued", "retrying"] } }, { $set: { status: "processing" }, $inc: { attempts: 1 } }, { new: true });
  if (!job) return;
  if (job.reservationId && !await CreditReservation.exists({ _id: job.reservationId, userId: job.userId, status: "reserved" })) { job.status = "failed"; job.error = "The credit reservation is no longer active. Request a new quote before generating."; await job.save(); return; }
  try {
    job.status = "processing";
    await job.save();
    const references = await imageReferences(job.userId, job.toObject(), true);
    const outputs = await generateGeminiImages({ ...job.toObject(), referenceImages: references.referenceImages, prompt: job.prompt + (references.characterDescription ? "\nCharacter continuity:\n" + references.characterDescription : "") });
    const assets = [];
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      const key = `${job.userId}/images/${job._id}-${index}.${output.contentType === "image/jpeg" ? "jpg" : "png"}`;
      const stored = await uploadImage(output.buffer, key, output.contentType);
      assets.push(await MediaAsset.create({ userId: job.userId, projectId: job.projectId, jobId: job._id, prompt: job.prompt, provider: job.provider, model: job.model, key: stored.key, bucket: stored.bucket, url: stored.url, contentType: output.contentType, sizeBytes: output.buffer.length, metadata: { tool: job.tool || "generate", sourceAssetIds: job.sourceAssetIds, stylePreset: job.stylePreset, aspectRatio: job.aspectRatio, resolution: job.resolution } }));
    }
    job.status = "completed";
    job.outputMetadata = { assetIds: assets.map((asset) => asset._id), count: assets.length };
    job.completedAt = new Date();
    await job.save();
    if (job.reservationId) {
      const costs = outputs.map(output => (output as any).providerData?.usage?.cost);
      const actual = costs.length && costs.every(c => typeof c === "number" && Number.isFinite(c) && c >= 0) ? costs.reduce((n, c) => n + c, 0) : undefined;
      const settled = await settleReservation(String(job.reservationId), actual);
      job.outputMetadata = { ...job.outputMetadata, creditsCharged: settled?.credits, providerCostUsd: actual }; await job.save();
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Image generation failed";
    await job.save();
    if (job.reservationId) await releaseReservation(String(job.reservationId), "image_generation_failed");
    throw error;
  }
}
