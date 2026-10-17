import { CreditReservation } from "../models/CreditReservation.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { VideoGenerationJob } from "../models/VideoGenerationJob.js";
import { createVeoOperation, downloadVeoVideos, pollVeoOperation } from "../services/videoGeneration.js";
import { uploadVideo } from "../services/mediaStorage.js";
import { releaseReservation, settleReservation } from "../services/wallet.js";
import { readSourceImage } from "../services/sourceImages.js";

export async function processVideoJob(jobId: string) {
  const job = await VideoGenerationJob.findOneAndUpdate({ _id: jobId, status: { $in: ["queued", "retrying"] } }, { $set: { status: "processing" }, $inc: { attempts: 1 } }, { new: true });
  if (!job) return;
  if (job.reservationId && !await CreditReservation.exists({ _id: job.reservationId, userId: job.userId, status: "reserved" })) { job.status = "failed"; job.error = "The credit reservation is no longer active. Request a new quote before generating."; await job.save(); return; }
  try {
    job.status = "processing";
    job.progress = 10;
    await job.save();
    const source = await MediaAsset.findOne({ _id: job.sourceImageAssetId, userId: job.userId, type: "image", deletedAt: null });
    if (!source) throw new Error("Source image is no longer available. Upload or select an image again.");
    const image = await readSourceImage(source);
    const operationName = job.providerJobId || await createVeoOperation({ ...job.toObject(), sourceImageBytes: image.buffer.toString("base64"), sourceImageMimeType: image.contentType });
    job.providerJobId = operationName;
    job.progress = 35;
    await job.save();
    const operation = await pollVeoOperation(operationName);
    job.progress = 80;
    await job.save();
    const outputs = await downloadVeoVideos(operation, { userId: String(job.userId), model: job.model });
    const assets = [];
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      if (Math.abs(output.metadata.durationSeconds - Number(job.durationSeconds)) > 0.5) throw new Error("Veo output duration does not match the requested clip. Review before regenerating.");
      const key = `${job.userId}/videos/${job._id}-${index}.mp4`;
      const stored = await uploadVideo(output.buffer, key, output.contentType);
      assets.push(await MediaAsset.create({ userId: job.userId, projectId: job.projectId, jobId: job._id, type: "video", prompt: job.motionPrompt, provider: job.provider, model: job.model, key: stored.key, bucket: stored.bucket, url: stored.url, contentType: output.contentType, sizeBytes: output.buffer.length, durationSeconds: output.metadata.durationSeconds, width: output.metadata.width, height: output.metadata.height, sceneId: job.sceneId, metadata: { nativeAudio: true, nativeDialogue: Boolean(job.dialogueLines?.length), audioReview: output.metadata.audioReview, intendedDialogue: job.dialogueLines, aspectRatio: job.aspectRatio, quality: job.quality, provider: output.metadata } }));
    }
    job.status = "completed";
    job.progress = 100;
    job.outputMetadata = { assetIds: assets.map((asset) => asset._id), count: assets.length };
    job.completedAt = new Date();
    await job.save();
    if (job.reservationId) {
      const costs = outputs.map(output => (output.metadata as any).usage?.cost);
      const actual = costs.length && costs.every(c => typeof c === "number" && Number.isFinite(c) && c >= 0) ? costs.reduce((n, c) => n + c, 0) : undefined;
      const settled = await settleReservation(String(job.reservationId), actual);
      job.outputMetadata = { ...job.outputMetadata, creditsCharged: settled?.credits, providerCostUsd: actual }; await job.save();
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Video generation failed";
    await job.save();
    if (job.reservationId) await releaseReservation(String(job.reservationId), "video_generation_failed");
    throw error;
  }
}
