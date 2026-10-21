import {CharacterProfile} from "../models/CharacterProfile.js";
import {sceneDialogue} from './sceneAudio.js';
import {StudioVideoReceipt} from '../models/StudioVideoReceipt.js';
import {CreditApproval} from "../models/CreditApproval.js";
import {CreditReservation} from "../models/CreditReservation.js";
import { providerFor } from "./openrouter.js";
import { ensureProductionEdit } from "./sharedEditing.js";
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
  const production: any = await StudioProduction.findOneAndUpdate({ _id: id, status: { $in: ["queued", "running", "awaiting_credit_execution", "executing_approval"] }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { leaseToken, leaseUntil: new Date(Date.now() + 45000) }, $inc: { attempts: 1 } }, { new: true });
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
  async function executeWithFallback(input:any,run:()=>Promise<any>){
    const {approvedMediaFallback}=await import("./modelPolicy.js");
    return approvedMediaFallback(input,current?.input.approvedAlternatives||[],{credits:current!.credits,providerCostUsd:Number(current!.pricing?.providerCostUsd)},async()=>{current!.executionModel=input.model;await checkpoint();return run();},async replacement=>{await assertProviderBudget(input.model,replacement.providerCostUsd);await studioLog(production,'processing','Selected an approved compatible fallback: '+input.model,current!.key);await checkpoint();});
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
    await checkpoint({status:production.approvalMode==="cards"?"executing_approval":"running"});
    if (!production.reservationId) throw new Error("Production needs an approved credit reserve");
    const card=production.approvalMode==="cards"?await CreditApproval.findOne({_id:production.activeApprovalId,userId:production.userId,productionId:production._id,status:"approved",reservationId:production.reservationId}):null;
    if(production.approvalMode==="cards"){
      const {approvalSignature}=await import("./agentApprovals.js");
      if(!card||approvalSignature(production,card.scope!,steps.filter(s=>card.stepKeys.includes(s.key)),card.credits)!==card.signature)throw new Error("This operation has no valid scoped credit approval. No provider request was submitted.");
    }
    async function awaitNextApproval(){
      await (await import("./agentApprovals.js")).finishCreditCard(production,"completed");
      await checkpoint({status:"paused",control:"pause"});
      await studioLog(production,"waiting","Approved operation complete. Waiting for the next credit approval inside chat.");
    }
    for (const step of steps) {
      current = step;
      if(step.kind==="video"&&!step.providerJobId){const receipt=await StudioVideoReceipt.findOne({productionId:production._id,userId:production.userId,stepKey:step.key,rejected:{$ne:true}}).lean();if(receipt){step.providerJobId=receipt.operationName;await checkpoint();}}
      if (step.status === "completed" || step.status === "skipped") continue;
      if(card&&!card.stepKeys.includes(step.key)){await awaitNextApproval();return;}
      if (step.kind === "audio" && step.input.track === "dialogue") {
        step.status = "skipped"; await checkpoint();
        await studioLog(production, "waiting", step.label + ": legacy separate dialogue skipped; prepare a new native-audio plan.", step.key); continue;
      }
      if (step.kind === "video" && !step.input.nativeAudio && production.snapshot.scenes.some((scene: any) => String(scene._id) === step.sceneId && sceneDialogue(scene).length)) {
        step.status = "needs_review"; throw new Error("This legacy dialogue plan requires a new native audiovisual quote. Completed assets are preserved; regenerate the scene with a new plan.");
      }
      if (await finishControl()) return;
      await checkGenerationUser(String(production.userId));
      const reserve=await CreditReservation.findOne({_id:production.reservationId,userId:production.userId,status:"reserved"});
      if(!reserve || (reserve.remainingCredits??reserve.credits)<step.credits)throw new Error("Approved production budget is closed or exhausted. No provider request was submitted.");
      if (!step.reused && !step.providerJobId) await assertProviderBudget(step.input.model, step.pricing?.providerCostUsd);
      if (step.input.model.startsWith("openrouter/") && !step.providerJobId) await (await import("./openrouterManagement.js")).checkProviderAffordability(Number(step.pricing?.providerCostUsd));
      const assets = await MediaAsset.find({ _id: { $in: steps.map(s => s.assetId).filter(Boolean) }, userId: production.userId, deletedAt: null }).lean();
      if (step.kind === "video") {
        const duration = sceneDuration(step.sceneId, steps, assets, Number(production.snapshot.scenes.find((scene:any)=>String(scene._id)===step.sceneId)?.estimatedDurationSeconds)||production.settings.targetSeconds / production.snapshot.scenes.length);
        if (!step.input.nativeDialogue && steps.filter(s=>s.kind==="video"&&s.sceneId===step.sceneId&&s.input.clipIndex<step.input.clipIndex).reduce((n,s)=>n+Number(s.input.durationSeconds),0)>=duration) {
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
          if (object) output = { ...object, durationSeconds: step.kind === "audio" ? wavDuration(object.buffer) : step.kind === "video" ? step.input.durationSeconds : undefined, providerUsage: step.kind === "video" ? await inspectNativeVideo(object.buffer,step.input.nativeAudio!==false) : undefined };
          else if (!step.providerJobId) {
            step.status = "needs_review";
            throw new Error("A provider request was interrupted before its result was saved. It will not be submitted again automatically. Review or regenerate this output with a new quote.");
          }
        }
        if (!output) {
          const input: any = { ...step.input, userId: String(production.userId),reservationId:String(production.reservationId) };
          if (step.kind === "image") {
            const scene=production.snapshot.scenes.find((s:any)=>String(s._id)===step.sceneId);
            const profiles=await CharacterProfile.find({projectId:production.projectId,userId:production.userId,name:{$in:scene?.characters||[]}}).lean();
            if((await import('./imageGeneration.js')).imageModels.find(m=>m.id===input.model)?.characterReference)input.characterReferenceIds=[...new Set([...(input.characterReferenceIds||[]),...profiles.map(c=>c.referenceAssetId?String(c.referenceAssetId):null).filter(Boolean)])].slice(0,4);
            input.referenceImages = [];
            for (const ref of input.characterReferenceIds ?? []) {
              const source = await ownedAsset(production, ref);
              if (source.type !== "image") throw new Error("Character reference must be an image");
              const bytes = await bytesFor(source, providers);
              input.referenceImages.push({ contentType: bytes.contentType, data: bytes.buffer.toString("base64") });
            }
          }
          if(step.kind==='video')input.onVideoSubmitted=async(operationName:string)=>{
            if(typeof operationName!=="string"||!operationName.trim())throw new Error("Provider did not return a video operation ID; review before retrying.");
            // Record acceptance independently before later worker checkpoints.
            step.providerJobId=operationName;step.providerPhase="accepted";
            await StudioVideoReceipt.updateOne({productionId:production._id,stepKey:step.key},{$setOnInsert:{userId:production.userId,operationName,model:input.model}},{upsert:true});
          };
          if (step.kind === "video" && !step.providerJobId) {
            const imageStep = steps.find(s => s.sceneId === step.sceneId && s.kind === "image" && s.status === "completed");
            if (!imageStep?.assetId) throw new Error("Scene image is not ready");
            const bytes = await bytesFor(await ownedAsset(production, imageStep.assetId), providers);
            input.sourceImageBytes = bytes.buffer.toString("base64"); input.sourceImageMimeType = bytes.contentType;
          }
          step.status = "requesting"; step.error = undefined;
          if(step.kind==="video"){step.providerPhase=step.providerJobId?"resuming":"submitting";step.submissionStartedAt=step.submissionStartedAt||new Date().toISOString();}
          await checkpoint();
          await studioLog(production, "processing", `${step.label}: ${step.providerJobId ? "resuming provider operation" : step.kind === "video" ? "submitting video request" : "generation submitted"} / billable, approved ceiling ${step.credits} credits`, step.key);
          if (step.kind === "image") {
            const outputs = await executeWithFallback(input,()=>providers.image(input)); output = outputs[0];
          } else if (step.kind === "audio") {
            const speech = await executeWithFallback(input,()=>providers.speech(input)); output = { ...speech, providerUsage: speech.providerData?.usage ?? speech.providerData?.usage_metadata };
          } else {
            if (!step.providerJobId) { const operationName=await providers.createVideo(input);await input.onVideoSubmitted(operationName);await checkpoint(); }
            if(!step.providerJobId)throw new Error("Provider did not return a video operation ID; review before retrying.");
            step.providerPhase="polling";await checkpoint();
            const operation = await providers.pollVideo(step.providerJobId);
            step.providerPhase="downloading";await checkpoint();
            const videos = await providers.downloadVideo(operation, { userId: String(production.userId), model: step.input.model,reservationId:String(production.reservationId),nativeAudio:step.input.nativeAudio!==false });
            const native = videos[0].metadata;
            if ((step.input.nativeAudio && !native?.nativeAudio) || Math.abs(Number(native?.durationSeconds) - step.input.durationSeconds) > 0.5) throw Object.assign(new Error("Generated native audiovisual clip is incomplete or has an unexpected duration. Review and regenerate with a new quote."), { mediaRejected: true });
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
        if(step.kind==="video")step.providerPhase="stored";
        step.stored = { key, bucket: stored.bucket, sizeBytes: output.buffer.length, contentType: output.contentType, durationSeconds: output.durationSeconds, providerUsage: output.providerUsage };
        await checkpoint();
        asset = await MediaAsset.findOneAndUpdate({ productionId: production._id, productionStepKey: step.key, userId: production.userId }, { $setOnInsert: {
          projectId: production.projectId, jobId: production._id, sceneId: step.sceneId, type: step.kind,
          provider: providerFor(step.executionModel||step.input.model), model: step.executionModel||step.input.model,
          prompt: step.input.prompt ?? step.input.text ?? step.input.motionPrompt, voiceId: step.input.voiceId,
          characterName: step.input.speaker, ...stored, contentType: output.contentType,
          sizeBytes: output.buffer.length, durationSeconds: output.durationSeconds,
          metadata: { nativeAudio: step.input.nativeAudio === true, nativeDialogue: step.input.nativeDialogue === true, audioReview: output.providerUsage?.audioReview, intendedDialogue: step.input.dialogueLines, name: step.label, sceneOrder: step.sceneOrder, settings: step.input, providerUsage: output.providerUsage ?? {}, credits: step.credits, estimatedProviderCostUsd: step.pricing?.providerCostUsd, providerCostIsEstimate: true }
        } }, { upsert: true, new: true });
      }
      await settleStudioStep(String(production.reservationId), step.key, step.credits, { productionId: id, sceneId: step.sceneId, assetId: asset._id, providerUsage: asset.metadata?.providerUsage, estimatedProviderCostUsd: step.pricing?.providerCostUsd });
      if(step.kind==='image'){
        const scene=production.snapshot.scenes.find((s:any)=>String(s._id)===step.sceneId);
        await CharacterProfile.updateMany({projectId:production.projectId,userId:production.userId,name:{$in:scene?.characters||[]},referenceAssetId:{$exists:false},$or:[{referenceImageUrl:{$exists:false}},{referenceImageUrl:''}]},{$set:{referenceAssetId:asset._id}});
      }
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
    await studioLog(production, "processing", "Free editing: saving the shared editor timeline, synchronized audio and available transcript captions.");
    const edit = await ensureProductionEdit({ ...production.toObject(), timeline });
    await studioLog(production, "success", `Shared editor ready at revision ${edit.revision}. Manual and Studio edits use this same saved timeline.`);
    if(card?.scope==="operation"&&production.settings.autoExport){await awaitNextApproval();return;}
    if(production.settings.autoExport){
      const {VideoExport}=await import("../models/VideoEdit.js");
      const {timelineSchema,exportSettingsSchema}=await import("@drex/shared");
      const {validateTimelineAssets}=await import("./videoEditing.js");
      const saved=timelineSchema.parse(edit.timeline);
      const duration=saved.clips.reduce((n,c)=>n+c.duration,0);
      if(production.estimate.renderCredits>0 && duration>Number(production.estimate.renderMaxSeconds)+.05)throw new Error("Timeline duration exceeds the approved rendering budget. Existing outputs are preserved; approve a new rendering quote in the editor.");
      const settings=exportSettingsSchema.parse({format:"mp4",resolution:"720p",quality:"standard",filename:"production"});
      await validateTimelineAssets(saved,String(production.userId),settings);
      const exportJob=await VideoExport.findOneAndUpdate({productionId:production._id,revision:edit.revision},{$setOnInsert:{userId:production.userId,projectId:production.projectId,editId:edit._id,revision:edit.revision,timeline:saved,settings,reservationId:production.reservationId,budgetCredits:production.estimate.renderCredits||0}},{upsert:true,new:true});
      await studioLog(production,exportJob?.status==="failed"?"failure":exportJob?.status==="completed"?"success":"waiting",`FFmpeg MP4 export ${exportJob?.status || "queued"}; uses the original approved budget and saved editor revision.`,"final-render");
    }else await closeStudioReserve(String(production.reservationId), "production_complete");
    await checkpoint({ status: "completed", completedAt: new Date(), error: "" });
    if(!production.settings.autoExport)await (await import("./agentApprovals.js")).finishCreditCard(production,"completed");
    await studioLog(production, "success", "Your video production is ready for review.");
  } catch (error: any) {
    if (lostLease) return;
    if (error.providerRejected && current?.kind === "video" && current.providerJobId) {
      await StudioVideoReceipt.updateOne({productionId:production._id,stepKey:current.key,operationName:current.providerJobId},{$set:{rejected:true}});
      current.failedProviderJobIds = [...(current.failedProviderJobIds ?? []), current.providerJobId];
      current.providerJobId = undefined;
    }
    if (error.mediaRejected && current) { current.status = "needs_review"; }
    console.warn(JSON.stringify({event:"studio_operation_failed",productionId:id,stepKey:current?.key,phase:current?.providerPhase,hasProviderJob:Boolean(current?.providerJobId),name:error.name,status:error.status||error.statusCode,code:error.code,providerRejected:Boolean(error.providerRejected)}));
    const uncertain = current?.status === "needs_review" || (current?.status === "requesting" && !current.providerJobId && !current.stored && !error.providerRejected);
    if(uncertain&&current?.kind==='video')error.message='The video request could not be confirmed. Completed assets are saved. Ask the agent to review or retry this output; replacement generation requires fresh approval.';
    else if(current?.providerJobId&&/timeout|timed out|abort|fetch|connection|network/i.test(error.message))error.message='The provider job is saved, but its result could not be retrieved yet. Ask the agent to retry; the existing job can be resumed without submitting it again.';
    if (current && current.status !== "completed") { current.status = uncertain ? "needs_review" : "failed"; current.error = error.message; }
    await checkpoint({ status: uncertain ? "needs_review" : "failed", error: error.message });
    if(production.approvalMode==="cards")await (await import("./agentApprovals.js")).finishCreditCard(production,"failed");
    if(production.approvalMode!=="cards"&&production.reservationId)await closeStudioReserve(String(production.reservationId),"production_failed_unused_released");
    // A retry must obtain a fresh approval after unused credits are released.
    await studioLog(production, "failure", error.message, current?.key);
  } finally {
    clearInterval(heartbeat);
    await StudioProduction.updateOne({ _id: id, leaseToken }, { $unset: { leaseUntil: 1, leaseToken: 1 } });
  }
}
