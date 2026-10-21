import { z } from "zod";
import mongoose from "mongoose";
import { StudioEvent, StudioProduction } from "../models/StudioProduction.js";
import { AIProject } from "../models/AIProject.js";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { Niche } from "../models/Niche.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { buildStudioSteps, StudioStep, studioSettingsSchema } from "./studioPlan.js";
import { priceStudioSteps } from "./studioPricing.js";
import { enqueueStudio, studioWorkerOnline } from "./studioQueue.js";
import { closeStudioReserve } from "./studioBilling.js";
import { studioLog } from "./studioExecution.js";


function fail(message:string,statusCode=400):never{throw Object.assign(new Error(message),{statusCode});}
const idSchema=z.string().regex(/^[a-f\d]{24}$/i,"Invalid ID");
export async function prepareProduction(userId:string,body:unknown,allowDraftPlanning=false,agentTaskId?:string){
  const input = z.object({ projectId: idSchema, settings: studioSettingsSchema, sourceProductionId: idSchema.optional(), regenerateStepKey: z.string().max(150).optional(),resumeExistingVideo:z.boolean().default(false) }).parse(body);
  if(agentTaskId&&!input.sourceProductionId){const existing=await StudioProduction.findOne({userId,"snapshot.agentTaskId":agentTaskId});if(existing){if(String(existing.projectId)!==input.projectId)fail("This agent request already belongs to another project",409);return existing;}}
  const project = await AIProject.findOne({ _id: input.projectId, userId: userId }).lean();
  if (!project || !project.approvedAt && !allowDraftPlanning) fail("Approve the script before creating a production plan");
  const characters = await CharacterProfile.find({ projectId: project!._id, userId: userId }).lean();
  const refs = [];
  for (const character of characters) {
    const reference = character.referenceImageUrl ? await MediaAsset.findOne({ userId: userId, type: "image", deletedAt: null, url: character.referenceImageUrl }).select("_id") : null;
    refs.push({ ...character, referenceAssetId: reference ? String(reference._id) : undefined });
  }
  const niche = project!.nicheId ? await Niche.findOne({ _id: project!.nicheId, userId: userId }).lean() : null;
  let snapshot: any = JSON.parse(JSON.stringify({ title: project!.title, summary: project!.summary, scenes: project!.scenes, characters: refs, niche, product: (project!.prompts as any)?.sourceSettings?.product }));
  if(!project!.approvedAt && allowDraftPlanning){snapshot.scenes=snapshot.scenes.map((scene:any)=>({...scene,approved:true}));snapshot.requiresScriptReview=true;}
  if(agentTaskId)snapshot.agentTaskId=agentTaskId;
  let settings = {...input.settings,agentSelectModels:input.settings.agentSelectModels||/gemini|google\/|^veo-/i.test([input.settings.imageModel,input.settings.voiceModel,input.settings.videoModel].join(" "))};
  let source: any;
  if (input.sourceProductionId) {
    source = await StudioProduction.findOne({ _id: input.sourceProductionId, userId: userId, projectId: input.projectId });
    if (!source || !["completed", "cancelled", "failed", "needs_review", "paused"].includes(source.status) || source.leaseUntil > new Date()) fail("Pause production before regenerating an output");
    snapshot = JSON.parse(JSON.stringify(source.snapshot));
    // The originating agent request identifies one original production only.
    // Preserve provenance without reusing that unique identity for regeneration.
    const originTaskId=snapshot.agentTaskId||snapshot.sourceAgentTaskId;
    delete snapshot.agentTaskId;
    if(originTaskId)snapshot.sourceAgentTaskId=originTaskId;
    if(agentTaskId&&agentTaskId!==originTaskId)snapshot.agentTaskId=agentTaskId;
    settings = studioSettingsSchema.parse(source.settings);
  }
  if (snapshot.product) {
    if (!(await (await import("../services/creditPricingEngine.js")).getPricingPolicy()).values.commercialEnabled) fail("Product commercials are disabled by the administrator");
    const ids = snapshot.product.assetIds || [];
    if (await MediaAsset.countDocuments({ _id: { $in: ids }, userId: userId, type: "image", deletedAt: null }) !== new Set(ids).size) fail("Product reference images are unavailable");
  }
  let modelSelections:any[]=[];
  if(settings.agentSelectModels&&!source){const chosen=await (await import("./studioModelSelection.js")).affordableStudioSettings(snapshot,settings);settings=chosen.settings;modelSelections=chosen.selections;}
  const steps = buildStudioSteps(snapshot, settings);
  for(const step of steps){const options=modelSelections.find(s=>s.kind===(step.kind==='audio'?'voice':step.kind))?.alternatives||[];step.input.approvedAlternatives=options.flatMap((o:any)=>o.steps.filter((s:any)=>s.key===step.key).map((s:any)=>({input:s.input,credits:s.credits,providerCostUsd:s.pricing?.providerCostUsd})));}
  if (source) {
    const selected = source.steps.find((s: StudioStep) => s.key === input.regenerateStepKey);
    if (!selected) fail("Select an output to regenerate");
    let resumableJob:string|undefined;
    if(input.resumeExistingVideo&&selected.kind==='video'&&['failed','needs_review'].includes(selected.status)){
      const {StudioVideoReceipt}=await import('../models/StudioVideoReceipt.js');const receipt=await StudioVideoReceipt.findOne({productionId:source._id,userId,stepKey:selected.key,rejected:{$ne:true}}).lean();resumableJob=selected.providerJobId||receipt?.operationName;
      if(selected.failedProviderJobIds?.includes(resumableJob))resumableJob=undefined;
    }
    for (const step of steps) {
      if(step.key===selected.key&&resumableJob){step.input={...selected.input};step.providerJobId=resumableJob;}
      const old = source.steps.find((s: StudioStep) => s.key === step.key);
      const dependsOnSelection = step.key === selected.key || (step.sceneId === selected.sceneId && step.kind === "video" && selected.kind !== "video");
      if (old?.status === "completed" && old.assetId && !dependsOnSelection && (step.kind !== "video" || old.input.nativeAudio === true || old.input.nativeAudio === false && step.input.nativeAudio === false && !step.input.nativeDialogue) && (step.kind !== "audio" || old.input.track === step.input.track)) { step.status = "completed"; step.assetId = old.assetId; step.reused = true; }
    }
  }
  const estimate:any = await priceStudioSteps(steps);estimate.modelSelections=modelSelections.map(({alternatives,...selection})=>selection);
  if(settings.autoExport){
    const {GenerationPriceRule}=await import("../models/GenerationPriceRule.js");
    const rule=await GenerationPriceRule.findOne({feature:"final_rendering",provider:"ffmpeg",model:"ffmpeg",active:true});
    const seconds=Math.max(settings.targetSeconds,estimate.maxVideoSeconds);
    const quote:any=rule?await (await import("./wallet.js")).createQuote({feature:"final_rendering",provider:"ffmpeg",model:"ffmpeg",unit:"minute",quantity:Math.max(1,seconds/60)}):{allowed:true,credits:0,estimatedCostUsd:0};
    if(!quote.allowed)estimate.missingPricing.push("Final rendering: "+quote.reason);
    else{estimate.renderCredits=quote.credits;estimate.renderQuote=quote;estimate.renderMaxSeconds=seconds;if(estimate.credits!==null)estimate.credits+=quote.credits;}
    estimate.renderMode="ffmpeg-mp4";
  }
  const values={ userId: userId, projectId: input.projectId, sourceProductionId: source ? String(source._id) : undefined, title: project!.title, snapshot, settings, steps, estimate, expiresAt: new Date(Date.now() + 10 * 60000) };
  let production;
  if(snapshot.agentTaskId){try{production=await StudioProduction.findOneAndUpdate({userId,"snapshot.agentTaskId":snapshot.agentTaskId},{$setOnInsert:values},{upsert:true,new:true});}catch(error:any){if(error.code!==11000)throw error;production=await StudioProduction.findOne({userId,projectId:input.projectId,"snapshot.agentTaskId":snapshot.agentTaskId});if(!production)throw error;}}
  else production=await StudioProduction.create(values);
  await studioLog(production, "waiting", "Production plan prepared. Awaiting credit approval.");
  return production;
}

export async function controlProduction(userId:string,productionId:string,body:unknown,workerReady=studioWorkerOnline){
  const production=await StudioProduction.findOne({_id:idSchema.parse(productionId),userId});
  if(!production)fail("Production not found",404);
  const { action } = z.object({ action: z.enum(["pause", "resume", "cancel", "retry"]) }).parse(body);
  if (["completed", "cancelled"].includes(production.status)) return production;
  if (action === "pause") {
    await StudioProduction.updateOne({ _id: production._id, status: { $in: ["queued", "running", "awaiting_credit_execution", "executing_approval"] } }, { $set: { control: "pause" } });
  } else if (action === "cancel") {
    await StudioProduction.updateOne({ _id: production._id }, { $set: { control: "cancel" } });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const cancelled = await StudioProduction.findOneAndUpdate({ _id: production._id, status: { $nin: ["completed", "cancelled"] }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { status: "cancelled" } }, { new: true, session });
        if (cancelled?.reservationId) await closeStudioReserve(String(cancelled.reservationId), "production_cancelled", session);
      });
    } finally { await session.endSession(); }
  } else {
    if (!["paused", "failed"].includes(production.status)) fail("Only paused or failed work can resume. Uncertain provider requests require a new regeneration quote.");
    if(!await (await import("../models/CreditReservation.js")).CreditReservation.exists({_id:production.reservationId,userId,status:"reserved"}))fail("Approve a fresh recovery quote inside chat before continuing",409);
    if(production.approvalMode==="cards"){
      const {CreditApproval}=await import("../models/CreditApproval.js");const {CreditReservation}=await import("../models/CreditReservation.js");
      if(!await CreditApproval.exists({_id:production.activeApprovalId,userId,status:"approved"})||!await CreditReservation.exists({_id:production.reservationId,userId,status:"reserved"}))fail("Approve the next operation inside chat before continuing");
    }
    if (!await workerReady()) fail("Studio worker is offline", 503);
    const steps = production.steps.map((s: StudioStep) => s.status === "failed" ? { ...s, status: "pending", error: undefined } : s);
    const updated = await StudioProduction.findOneAndUpdate({ _id: production._id, status: production.status, control: { $ne: "cancel" }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { status: production.approvalMode==="cards"?"awaiting_credit_execution":"queued", control: "run", steps, error: "" }, $inc: { queueRevision: 1 } }, { new: true });
    if (!updated) fail("Wait for the current operation to finish");
    await enqueueStudio(updated).catch(() => null);
  }
  await studioLog(production, action === "cancel" ? "cancelled" : "waiting", `${action} requested. Already-submitted provider work may finish before pending work stops.`);
  return StudioProduction.findOne({_id:production._id,userId});
}
