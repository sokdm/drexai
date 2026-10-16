import { providerFor } from "./openrouter.js";
import { inspectNativeVideo } from "./nativeAudio.js";
import { assertProviderBudget, checkGenerationUser } from "./platformControl.js";
import { randomUUID } from "node:crypto";
import { StudioEvent, StudioProduction } from "../models/StudioProduction.js";
import { AIProject } from "../models/AIProject.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { generateGeminiImages } from "./imageGeneration.js";
import { generateGeminiSpeech, wavDuration } from "./textToSpeech.js";
import { createVeoOperation, pollVeoOperation, downloadVeoVideos } from "./videoGeneration.js";
import { readMediaObject, uploadImage, uploadAudio, uploadVideo } from "./mediaStorage.js";
import { closeStudioReserve, settleStudioStep } from "./studioBilling.js";
import { makeTimeline, requiredClips, sceneDuration, StudioStep } from "./studioPlan.js";

export const studioProviders = { image: generateGeminiImages, speech: generateGeminiSpeech, createVideo: createVeoOperation, pollVideo: pollVeoOperation, downloadVideo: downloadVeoVideos, read: readMediaObject, uploadImage, uploadAudio, uploadVideo };
export type StudioProviders = typeof studioProviders;

export async function studioLog(production: any, level: string, message: string, stepKey?: string) {
  await StudioEvent.create({ productionId: production._id, userId: production.userId, level, message, stepKey });
}

async function ownedAsset(production: any, id: string) {
  const asset = await MediaAsset.findOne({ _id: id, userId: production.userId, deletedAt: null });
  if (!asset) throw new Error("A production asset is missing or unavailable");
  return asset;
}

async function bytesFor(asset: any, providers: StudioProviders) {
  if (asset.url?.startsWith("data:")) {
    const match = asset.url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error("Invalid source image");
    return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] };
  }
  const stored = await providers.read(asset.key);
  if (!stored) throw new Error("Source media object is unavailable");
  return stored;
}

export async function runStudioProduction(id: string, providers: StudioProviders = studioProviders) {
  const leaseToken = randomUUID();
  const production: any = await StudioProduction.findOneAndUpdate({ _id: id, status: { $in: ["queued", "running"] }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { status: "running", leaseToken, leaseUntil: new Date(Date.now() + 45000) }, $inc: { attempts: 1 } }, { new: true });
  if (!production) return;
  let lostLease = false;
  const heartbeat = setInterval(() => {
    StudioProduction.updateOne({ _id: id, leaseToken }, { $set: { leaseUntil: new Date(Date.now() + 45000) } }).then(r => { if (!r.matchedCount) lostLease = true; }).catch(() => { lostLease = true; });
  }, 10000);
  const steps = production.steps as StudioStep[];
  let current: StudioStep | undefined;
  async function checkpoint(values: Record<string, unknown> = {}) {
    if (lostLease) throw new Error("Worker lease lost; production will recover");
    const result = await StudioProduction.updateOne({ _id: id, leaseToken }, { $set: { steps, ...values } });
    if (!result.matchedCount) { lostLease = true; throw new Error("Worker lease lost"); }
  }
  async function finishControl() {
    const fresh = await StudioProduction.findById(id).select("control");
    if (fresh?.control === "cancel") {
      if (production.reservationId) await closeStudioReserve(String(production.reservationId), "production_cancelled");
      await checkpoint({ status: "cancelled" });
      await studioLog(production, "cancelled", "Pending work cancelled. Completed outputs were preserved and unused credits released.");
      return true;
    }
    if (fresh?.control === "pause") {
      await checkpoint({ status: "paused" });
      await studioLog(production, "waiting", "Paused before the next operation.");
      return true;
    }
    return false;
  }
  try {
    if (!production.reservationId) throw new Error("Production needs an approved credit reserve");
    for (const step of steps) {
      current = step;
      if (step.status === "completed" || step.status === "skipped") continue;
      if (step.kind === "audio" && step.input.track === "dialogue") {
        step.status = "skipped"; await checkpoint();
        await studioLog(production, "waiting", step.label + ": legacy separate dialogue skipped; prepare a new native-audio plan.", step.key); continue;
      }
      if (step.kind === "video" && !step.input.nativeAudio && production.snapshot.scenes.some((scene: any) => String(scene._id) === step.sceneId && (scene.dialogue?.trim() || scene.dialogueLines?.length))) {
        step.status = "needs_review"; throw new Error("This legacy dialogue plan requires a new native audiovisual quote. Completed assets are preserved; regenerate the scene with a new plan.");
      }
      if (await finishControl()) return;
      await checkGenerationUser(String(production.userId));
      if (!step.reused) await assertProviderBudget(step.input.model, step.pricing?.providerCostUsd);
      if (step.input.model.startsWith("openrouter/") && !step.providerJobId) await (await import("./openrouterManagement.js")).checkProviderAffordability(Number(step.pricing?.providerCostUsd));
      const assets = await MediaAsset.find({ _id: { $in: steps.map(s => s.assetId).filter(Boolean) }, userId: production.userId, deletedAt: null }).lean();
      if (step.kind === "video") {
        const duration = sceneDuration(step.sceneId, steps, assets, production.settings.targetSeconds / production.snapshot.scenes.length);
        if (!step.input.nativeDialogue && step.input.clipIndex >= requiredClips(duration, production.settings)) {
          step.status = "skipped"; await checkpoint();
          await studioLog(production, "cancelled", `${step.label} skipped; measured audio is already covered.`, step.key);
          continue;
        }
      }
      let asset: any = await MediaAsset.findOne({ productionId: production._id, productionStepKey: step.key, userId: production.userId, deletedAt: null });
      const ext = step.kind === "image" ? "png" : step.kind === "audio" ? "wav" : "mp4";
      const key = `${production.userId}/studio/${id}/${step.key}.${ext}`;
      if (!asset) {
        let output: { buffer: Buffer; contentType: string; durationSeconds?: number; providerUsage?: any } | undefined;
        const recovering = step.status === "requesting" || Boolean(step.stored);
        if (recovering) {
          const object = await providers.read(key);
          if (object) output = { ...object, durationSeconds: step.kind === "audio" ? wavDuration(object.buffer) : step.kind === "video" ? step.input.durationSeconds : undefined, providerUsage: step.kind === "video" ? await inspectNativeVideo(object.buffer) : undefined };
          else if (!step.providerJobId) {
            step.status = "needs_review";
            throw new Error("A provider request was interrupted before its result was saved. It will not be submitted again automatically. Review or regenerate this output with a new quote.");
          }
        }
        if (!output) {
          const input: any = { ...step.input, userId: String(production.userId) };
          if (step.kind === "image") {
            input.referenceImages = [];
            for (const ref of input.characterReferenceIds ?? []) {
              const source = await ownedAsset(production, ref);
              if (source.type !== "image") throw new Error("Character reference must be an image");
              const bytes = await bytesFor(source, providers);
              input.referenceImages.push({ contentType: bytes.contentType, data: bytes.buffer.toString("base64") });
            }
          }
          if (step.kind === "video" && !step.providerJobId) {
            const imageStep = steps.find(s => s.sceneId === step.sceneId && s.kind === "image" && s.status === "completed");
            if (!imageStep?.assetId) throw new Error("Scene image is not ready");
            const bytes = await bytesFor(await ownedAsset(production, imageStep.assetId), providers);
            input.sourceImageBytes = bytes.buffer.toString("base64"); input.sourceImageMimeType = bytes.contentType;
          }
          step.status = "requesting"; step.error = undefined;
          await checkpoint();
          await studioLog(production, "processing", `${step.label}: ${step.providerJobId ? "resuming provider operation" : "generation submitted"}`, step.key);
          if (step.kind === "image") {
            const outputs = await providers.image(input); output = outputs[0];
          } else if (step.kind === "audio") {
            const speech = await providers.speech(input); output = { ...speech, providerUsage: speech.providerData?.usage ?? speech.providerData?.usage_metadata };
          } else {
            if (!step.providerJobId) { step.providerJobId = await providers.createVideo(input); await checkpoint(); }
            const operation = await providers.pollVideo(step.providerJobId);
            const videos = await providers.downloadVideo(operation, { userId: String(production.userId), model: step.input.model });
            const native = videos[0].metadata;
            if (step.input.nativeAudio && (!native?.nativeAudio || Math.abs(Number(native.durationSeconds) - step.input.durationSeconds) > 0.5)) throw Object.assign(new Error("Generated native audiovisual clip is incomplete or has an unexpected duration. Review and regenerate with a new quote."), { mediaRejected: true });
            output = { ...videos[0], durationSeconds: native?.durationSeconds ?? step.input.durationSeconds, providerUsage: { ...((operation.response as any)?.usageMetadata ?? {}), ...native } };
          }
          if (!output?.buffer?.length) throw new Error("Provider returned an empty output");
        }
        if (step.kind === "video" && step.input.nativeAudio) {
          await studioLog(production, "processing", step.label + ": checking native dialogue audio", step.key);
          if (!output?.providerUsage?.nativeAudio) throw Object.assign(new Error("Native audio verification is missing. Review this result before regenerating."), { mediaRejected: true });
          await studioLog(production, "success", step.label + ": audio track detected", step.key);
          await studioLog(production, "review", step.label + ": dialogue, speaker identity, voice consistency and lip-sync require user review", step.key);
        }
        if (lostLease) throw new Error("Worker lease lost before storage");
        const upload = step.kind === "image" ? providers.uploadImage : step.kind === "audio" ? providers.uploadAudio : providers.uploadVideo;
        const stored = await upload(output.buffer, key, output.contentType);
        step.stored = { key, bucket: stored.bucket, sizeBytes: output.buffer.length, contentType: output.contentType, durationSeconds: output.durationSeconds, providerUsage: output.providerUsage };
        await checkpoint();
        asset = await MediaAsset.findOneAndUpdate({ productionId: production._id, productionStepKey: step.key, userId: production.userId }, { $setOnInsert: {
          projectId: production.projectId, jobId: production._id, sceneId: step.sceneId, type: step.kind,
          provider: providerFor(step.input.model), model: step.input.model,
          prompt: step.input.prompt ?? step.input.text ?? step.input.motionPrompt, voiceId: step.input.voiceId,
          characterName: step.input.speaker, ...stored, contentType: output.contentType,
          sizeBytes: output.buffer.length, durationSeconds: output.durationSeconds,
          metadata: { nativeAudio: step.input.nativeAudio === true, nativeDialogue: step.input.nativeDialogue === true, audioReview: output.providerUsage?.audioReview, intendedDialogue: step.input.dialogueLines, name: step.label, sceneOrder: step.sceneOrder, settings: step.input, providerUsage: output.providerUsage ?? {}, credits: step.credits, estimatedProviderCostUsd: step.pricing?.providerCostUsd, providerCostIsEstimate: true }
        } }, { upsert: true, new: true });
      }
      await settleStudioStep(String(production.reservationId), step.key, step.credits, { productionId: id, sceneId: step.sceneId, assetId: asset._id, providerUsage: asset.metadata?.providerUsage, estimatedProviderCostUsd: step.pricing?.providerCostUsd });
      step.assetId = String(asset._id); step.charged = true; step.status = "completed"; step.error = undefined;
      await checkpoint();
      await studioLog(production, "success", `${step.label} ready.`, step.key);
    }
    if (await finishControl()) return;
    const assets = await MediaAsset.find({ _id: { $in: steps.map(s => s.assetId).filter(Boolean) }, userId: production.userId, deletedAt: null }).lean();
    await studioLog(production, "processing", "Assembling audiovisual timeline with native soundtracks and optional off-screen narration.");
    const timeline = makeTimeline(production.snapshot, production.settings, steps, assets);
    await checkpoint({ timeline });
    await AIProject.updateOne({ _id: production.projectId, userId: production.userId }, { $set: { latestProductionId: production._id, productionTimeline: timeline } });
    await closeStudioReserve(String(production.reservationId), "production_complete");
    await checkpoint({ status: "completed", completedAt: new Date(), error: "" });
    await studioLog(production, "success", "Your video production is ready for review.");
  } catch (error: any) {
    if (lostLease) return;
    if (error.providerRejected && current?.kind === "video" && current.providerJobId) {
      current.failedProviderJobIds = [...(current.failedProviderJobIds ?? []), current.providerJobId];
      current.providerJobId = undefined;
    }
    if (error.mediaRejected && current) { current.status = "needs_review"; }
    const uncertain = current?.status === "needs_review" || (current?.status === "requesting" && !current.providerJobId && !current.stored && !error.providerRejected);
    if (current && current.status !== "completed") { current.status = uncertain ? "needs_review" : "failed"; current.error = error.message; }
    await checkpoint({ status: uncertain ? "needs_review" : "failed", error: error.message });
    // Unspent funds remain reserved while recoverable work is paused; cancellation releases them.
    await studioLog(production, "failure", error.message, current?.key);
  } finally {
    clearInterval(heartbeat);
    await StudioProduction.updateOne({ _id: id, leaseToken }, { $unset: { leaseUntil: 1, leaseToken: 1 } });
  }
}
