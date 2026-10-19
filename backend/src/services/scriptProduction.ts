import {publicChatError} from "./chatAccess.js";
import { z } from "zod";
import { ScriptJob } from "../models/ScriptJob.js";
import { AIProject } from "../models/AIProject.js";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { routerText, GatewayUsage } from "./openrouter.js";
import { AIConversation } from "../models/AIConversation.js";
import { scriptProjectSchema } from "./gemini.js";
import { settleReservation, releaseReservation } from "./wallet.js";
export const scriptSettings = z.object({ sceneBatchSize:z.number().int().min(1).max(2).default(1), audioMode:z.enum(["auto","dialogue","narration","mixed","silent"]).default("auto"), modelMode: z.enum(["auto", "configured", "free", "paid"]).default("configured"), storyTopic: z.string().trim().min(2).max(6000), nicheId: z.preprocess(v => v === "" ? undefined : v, z.string().regex(/^[a-f0-9]{24}$/i).optional()), type: z.string().max(100).default("Animated story"), genre: z.string().max(100).default("Adventure"), language: z.string().max(100).default("English"), targetDuration: z.string().max(50).default("8 minutes"), visualStyle: z.string().max(200).default("Cinematic"), audience: z.string().max(200).default("General audience"), tone: z.string().max(200).default("Engaging"), dialoguePreference: z.string().max(100).optional(), product: z.object({ name: z.string().trim().min(1).max(150), benefits: z.string().trim().min(2).max(2000), audience: z.string().max(300), callToAction: z.string().max(300), assetIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(4) }).optional(), sceneCount: z.number().int().min(1).max(40).optional(), numberOfCharacters: z.number().int().min(1).max(10).optional() });
export function scriptShape(settings: any) { const raw = Number(String(settings.targetDuration).match(/[\d.]+/)?.[0] || 8); const seconds = Math.round(Math.min(1800, Math.max(1, /second/i.test(settings.targetDuration) ? raw : raw * 60))); const scenes = Math.min(40, Math.max(1, settings.sceneCount || Math.ceil(seconds / 30))); return { seconds, scenes, calls: 1 + Math.ceil(scenes / (settings.sceneBatchSize||2)) }; }
export function scriptOutputBudget(settings:any){const shape=scriptShape(settings);return Math.min(12000,Math.max(3000,Math.ceil(2000+shape.seconds/shape.scenes*16*(settings.sceneBatchSize||2)),shape.scenes*100+1000));}
const planSchema = z.object({ title: z.string(), storyConcept: z.string(), summary: z.string(), characters: scriptProjectSchema.shape.characters, scenes: z.array(z.object({ title: z.string(), purpose: z.string(), duration: z.number().positive() })).min(1).max(40) });
export function scriptBatchSchema(start: number, count: number) {
 const keys = Array.from({ length: count }, (_, i) => `scene_${start + i}`);
 const scene = scriptProjectSchema.shape.scenes.element.extend({sceneDescription:z.string().max(1200),imagePrompt:z.string().max(1000),videoMotionPrompt:z.string().max(1000),cameraDirection:z.string().max(400),audioSuggestions:z.string().max(400),transitionSuggestions:z.string().max(300),estimatedNarrationTiming:z.string().optional()}).transform(row=>({...row,estimatedNarrationTiming:row.estimatedNarrationTiming?.trim()||Math.max(1,Math.round(spokenWordCount(row)*3/7))+" seconds (estimated from spoken text)"}));
 const object = z.object(Object.fromEntries(keys.map(key => [key, scene])));
 return z.preprocess((value: any) => {
  // Accept a complete legacy array, but never discard or invent missing scenes.
  if (value && Array.isArray(value.scenes) && value.scenes.length === count) {
   const ordered = keys.map((_, i) => value.scenes.find((s: any) => s.order === start + i));
   if (ordered.every(Boolean)) return Object.fromEntries(keys.map((key, i) => [key, ordered[i]]));
  }
  return value;
 }, object);
}
export function spokenWordCount(scene: any) {
 const speech = [scene.narration || "", scene.dialogueLines?.length ? scene.dialogueLines.map((line: any) => line.text).join(" ") : scene.dialogue || ""].join(" ");
 return speech.trim().split(/\s+/).filter(Boolean).length;
}
export function scriptExpansionFits(quote: any, rows: any[], remainingCalls: number) {
 const ceiling = Number(quote.estimatedCostUsd), calls = Number(quote.quantity);
 if (!(ceiling > 0) || !Number.isSafeInteger(calls) || calls < 1 || !Number.isSafeInteger(remainingCalls) || remainingCalls < 0 || !rows.length || rows.some(r => typeof r.costUsd !== "number" || !Number.isFinite(r.costUsd) || r.costUsd < 0)) return false;
 const spent = rows.reduce((n, r) => n + r.costUsd, 0);
 // Retain the frozen worst-case allowance for every remaining batch plus this expansion.
 return spent + ceiling / calls * (remainingCalls + 1) <= ceiling - 0.000000001;
}
async function log(job: any, stage: string, message: string) { await ScriptJob.updateOne({ _id: job._id }, { $push: { logs: { stage, message, at: new Date() } }, leaseUntil: new Date(Date.now() + 240000) }); }
export async function processScriptJob(job: any, request = routerText) {
 const input = job.input, shape = scriptShape(input.settings), quote = job.quote;
 const batchSize=input.settings.sceneBatchSize||2;
 const audioMode=input.settings.audioMode||"auto";
 const invoke = async (schema: any, system: string, prompt: string) => {
  await ScriptJob.updateOne({ _id: job._id }, { inFlight: true, leaseUntil: new Date(Date.now() + 240000) });
  const options = { model: quote.model, userId: String(job.userId), reservationId: String(job.reservationId), requestLimits: quote.requestLimits, schema, maxOutputTokens: Math.min(12000, quote.requestLimits?.maxOutputTokens ?? 5000), reasoningEffort: "low" as const, disableReasoning:true, timeoutMs: 180000, system, prompt };
  let raw: string;
  try { raw = await request(options); }
  catch (e: any) {
   if (!e.providerRejected || ![429, 503].includes(e.status)) throw e;
   await log(job, "retrying", "Provider explicitly rejected this request before generation. Retrying once; ambiguous timeouts are never retried.");
   raw = await request(options);
  }
  await ScriptJob.updateOne({_id:job._id},{inFlight:false});
  const decoded = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  const validated = schema.safeParse(decoded);
  if (!validated.success) {
   const first = validated.error.issues[0];
   throw new Error(`The script response has a missing or invalid field: ${first.path.join(".") || "response"} (${first.message}). Completed scenes are preserved; no extra generation was submitted.`);
  }
  return validated.data;
 };
 try {
  let plan = job.plan, project: any = job.resultProjectId ? await AIProject.findById(job.resultProjectId) : null;
  if (!plan) {
   await log(job, "planning", "Planning the story arc, characters, hook and ending");
   plan = await invoke(planSchema.extend({ scenes: planSchema.shape.scenes.min(shape.scenes).max(shape.scenes) }), "Plan an original complete video narrative. Return concise structured JSON only. Keep each scene purpose under 35 words. Honor audioMode: dialogue means character speech only, narration means off-screen voiceover, mixed allows both, silent means no spoken words, auto chooses naturally from the request. Include a hook, developed middle, character motivations and satisfying ending. Return exactly the requested sceneCount; do not combine scenes. Do not generate images or call media services.", JSON.stringify({ settings: input.settings, sceneCount: shape.scenes, targetSeconds: shape.seconds, editInstruction: input.message, existing: input.snapshot ? { title: input.snapshot.title, summary: input.snapshot.summary, scenes: input.snapshot.scenes.map((s: any) => ({ title: s.title, narration: s.narration, dialogue: s.dialogue })) } : undefined }));
   if (plan.scenes.length !== shape.scenes) throw new Error("The planning response did not contain the required scene count");
   project = await AIProject.create({ userId: job.userId, title: plan.title, storyConcept: plan.storyConcept, summary: plan.summary, type: input.settings.type, language: input.settings.language, targetDuration: input.settings.targetDuration, visualStyle: input.settings.visualStyle, nicheId: input.settings.nicheId, prompts: { sourceSettings: input.settings, scriptJobId: String(job._id), partial: true }, scenes: [] });
   await ScriptJob.updateOne({ _id: job._id }, { plan, resultProjectId: project._id, inFlight: false });
   for (const character of plan.characters) await CharacterProfile.create({ ...character, userId: job.userId, projectId: project._id });
  }
  if (!project) throw new Error("Saved script draft is missing");
  for (let index = job.cursor || 0; index < plan.scenes.length; index += batchSize) {
   const count = Math.min(batchSize, plan.scenes.length - index), duration = shape.seconds / shape.scenes;
   await log(job, "writing", `Writing scenes ${index + 1} to ${index + count} of ${plan.scenes.length}`);
   const keys = Array.from({ length: count }, (_, i) => `scene_${index + i + 1}`);
   const schema = scriptBatchSchema(index + 1, count);
   const wordTarget = { minimumPerScene: Math.ceil(duration * 2), targetPerScene: Math.ceil(duration * 2.4), maximumPerScene: Math.ceil(duration * 2.8) };
   const result = await invoke(schema, "Return one JSON object with exactly these REQUIRED keys: " + keys.join(", ") + ". Each key contains one complete scene object. Do not return a scenes array, a single combined scene, or scenes outside this batch. Keep the response bounded: use only the requested scene keys; total spoken text must stay within spokenWordTarget.maximumPerScene for each scene. Honor settings.audioMode. Dialogue-only and silent scenes must have empty narration and offscreenNarration false; silent scenes have no dialogue. Narration is spoken voiceover, never a substitute for sceneDescription. For auto mode select dialogue, narration, mixed or silent per scene based on the story and request. Set offscreenNarration true only for actual voiceover. Write fully developed original screenplay scenes. Include narration, attributed dialogue, scene descriptions, camera directions, image prompts, video motion prompts, sound descriptions and transition suggestions. Match language and tone. Meet the supplied spokenWordTarget separately for EACH scene using narration plus dialogue. Develop actual action, discoveries, conflict and character decisions; do not provide a synopsis or repeat filler to meet length. Technical directions do not count as spoken words. Scene lengths describe the edited story, NOT a single provider video clip. Audio and shot prompts are descriptive, not model-specific. Include the hook in the first scene and a complete ending in the last. Do not repeat prior scenes. Keep non-spoken technical directions concise: each image/video prompt under 100 words, other direction fields under 40 words. Supply only the required JSON, without explanations.", JSON.stringify({ settings: input.settings, characters: plan.characters, story: plan.summary, requiredSceneKeys: keys, requiredSceneCount: count, scenes: plan.scenes.slice(index, index + count), startOrder: index + 1, secondsPerScene: duration, spokenWordTarget: wordTarget, precedingScene: project.scenes.at(-1)?.narration || "", instruction: input.message }));
   let scenes = keys.map((key, i) => ({ ...result[key], ...(["dialogue","silent"].includes(audioMode)?{narration:"",offscreenNarration:false}:{}), ...(audioMode==="silent"?{dialogue:"",dialogueLines:[]}:{}), audioMode:audioMode==="auto"?result[key].audioMode:audioMode, order: index + i + 1, estimatedDurationSeconds: duration }));
   if (audioMode!=="silent" && scenes.some(s => s.audioMode!=="silent" && spokenWordCount(s) < duration * 1.8)) {
    // Persist the usable response before considering another billable request.
    await ScriptJob.updateOne({ _id: job._id }, { pendingBatch: { index, scenes } });
    const usage = await GatewayUsage.find({ reservationId: job.reservationId, status: "completed" }).lean();
    const remaining = Math.ceil((plan.scenes.length - index - count) / batchSize);
    if (scriptExpansionFits(quote, usage, remaining)) {
     await log(job, "expanding", `Developing scenes ${index + 1} to ${index + count} within the approved provider-cost ceiling`);
     try {
      const expanded = await invoke(schema, "Expand the supplied short screenplay scenes into developed narration and dialogue. Return exactly the required scene keys with complete scene objects. Meet spokenWordTarget per scene. Preserve titles, continuity, speaker identities and visual prompts. Add meaningful story beats, not repeated padding. No explanations outside JSON.", JSON.stringify({ requiredSceneKeys: keys, scenes, spokenWordTarget: wordTarget, language: input.settings.language, story: plan.summary }));
      scenes = scenes.map((s, i) => spokenWordCount(expanded[keys[i]]) > spokenWordCount(s) ? { ...expanded[keys[i]], order: s.order, estimatedDurationSeconds: duration } : s);
     } catch (error: any) {
      if (/abort|timeout|network|fetch failed/i.test(error.message)) throw error;
      const after = await GatewayUsage.find({ reservationId: job.reservationId, status: "completed" }).lean();
      if (!error.providerRejected && !(after.length > usage.length && after.every(r => typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0))) throw Object.assign(new Error("The optional expansion's provider charge could not be confirmed. Its saved draft is preserved for billing review; no additional call will be submitted."), { billingUncertain: true });
      await log(job, "review", "The optional expansion was not usable. Keeping the saved draft and estimating its actual spoken length.");
     }
    } else await log(job, "review", "Keeping the valid draft. Additional expansion would require a new approved quote or verified provider usage.");
   }
   scenes = scenes.map(s => ({ ...s, ...(["dialogue","silent"].includes(audioMode)?{narration:"",offscreenNarration:false}:{}), ...(audioMode==="silent"?{dialogue:"",dialogueLines:[]}:{}), estimatedDurationSeconds: audioMode==="silent"||s.audioMode==="silent"?duration:Math.max(1, Math.round(spokenWordCount(s) * 3 / 7)) }));
   project.scenes.push(...scenes); await project.save();
   await ScriptJob.updateOne({ _id: job._id }, { cursor: index + count, inFlight: false, $unset: { pendingBatch: "" } });
   await log(job, "prompts", `Saved scenes ${index + 1} to ${index + count}, including dialogue and visual prompts`);
  }
  const estimatedSeconds = project.scenes.reduce((n: number, s: any) => n + (s.estimatedDurationSeconds || 0), 0);
  const durationReview = estimatedSeconds < shape.seconds * .9;
  project.prompts = { ...project.prompts, partial: false, durationEstimate: { requestedSeconds: shape.seconds, estimatedSeconds, needsReview: durationReview, note: "Speech timing is estimated; delivery and visual pauses affect final duration." } };
  if (durationReview) await log(job, "review", `Draft saved: approximately ${estimatedSeconds} seconds of scene timing versus ${shape.seconds} requested. Review or request a longer revision; no duration was invented.`);
  if (input.projectId) {
   const existing = await AIProject.findOne({ _id: input.projectId, userId: job.userId });
   if (!existing || existing.updatedAt.getTime() !== new Date(job.baseUpdatedAt).getTime()) throw new Error("The project changed while the agent was writing. The agent draft is saved separately; review it before replacing your edits.");
   existing.versions.push({ label: "Before script agent revision", scenes: existing.scenes });
   const target = input.message?.match(/(?:rewrite|regenerate)\s+scene\s+(\d+)/i);
   const promptsOnly = /image prompts? for every scene/i.test(input.message || "");
   const dialogueOnly = /dialogue.*natural/i.test(input.message || "");
   const adding = /add\s+(five|[1-9]\d?)\s+scenes/i.test(input.message || "");
   const revised = project.scenes.map((s: any, index: number) => {
    const before: any = existing.scenes[index];
    if (before && adding) return before.toObject();
    if (before && target && index !== Number(target[1]) - 1) return before.toObject();
    if (before && promptsOnly) return { ...before.toObject(), imagePrompt: s.imagePrompt };
    if (before && dialogueOnly) return { ...before.toObject(), dialogue: s.dialogue, dialogueLines: s.dialogueLines };
    return { ...s.toObject(), ...(before ? { _id: before._id } : {}) };
   });
   if (target && (Number(target[1]) < 1 || Number(target[1]) > existing.scenes.length)) throw new Error("Requested scene does not exist. Agent draft preserved separately.");
   existing.scenes = revised as any;
   existing.targetDuration = input.settings.targetDuration;
   existing.prompts = { ...existing.prompts, partial: false, sourceSettings: input.settings, durationEstimate: project.prompts.durationEstimate };
   if (!target && !promptsOnly && !dialogueOnly) { existing.summary = project.summary; existing.title = project.title; }
   existing.approvedAt = undefined; existing.aiStudioReadyAt = undefined; await existing.save();
   await CharacterProfile.updateMany({ projectId: project._id, userId: job.userId }, { projectId: existing._id });
   await AIConversation.create({ userId: job.userId, projectId: existing._id, title: "Script revision", messages: [{ role: "user", content: input.message || "Revise the script" }, { role: "assistant", content: "Applied the requested revision to the saved script. Previous scenes are retained in project versions." }] });
   await ScriptJob.updateOne({ _id: job._id }, { projectId: existing._id });
  } else await ScriptJob.updateOne({ _id: job._id }, { projectId: project._id });
  await project.save();
  await log(job, "saving", "Script saved and ready for review; no images or videos were generated");
  await settleReservation(String(job.reservationId));
  await ScriptJob.updateOne({ _id: job._id }, { status: "completed", inFlight: false });
 } catch (error: any) {
  const freeOnly = quote.estimatedCostUsd === 0 && !(quote.requestLimits?.fallbacks || []).some((f:any) => !f.model.endsWith(":free"));
  const timedOut = /abort|timeout|timed out/i.test(error.message);
  const uncertain = !freeOnly && (error.billingUncertain === true || /abort|timeout|network|fetch failed/i.test(error.message));
  console.warn(JSON.stringify({event:"script_stage_failure",jobId:String(job._id),stage:job.cursor||0,code:error.code,status:error.status,finishReason:error.finishReason,name:error.name,uncertain}));
  if(!uncertain)await ScriptJob.updateOne({_id:job._id},{inFlight:false});
  const failureMessage = quote.feature === "ai_research_chat" ? publicChatError(error) : timedOut ? (freeOnly ? "Free script provider timeout: no response arrived before the deadline. Saved scenes are preserved and your reserved credits have been released. Try again or select a paid model." : "Script provider timeout: no response arrived before the deadline. Saved scenes are preserved. This request needs billing review before retrying to prevent duplicate charges.") : error.message;
  await log(job, "error", failureMessage);
  if (error.code === "INCOMPLETE_PROVIDER_OUTPUT") await ScriptJob.updateOne({ _id: job._id }, { outputFailure: { finishReason: error.finishReason, maxOutputTokens: error.maxOutputTokens, usage: error.usage, requestId: error.requestId } });
  await ScriptJob.updateOne({ _id: job._id }, { status: uncertain ? "needs_review" : "failed", error: failureMessage });
  // Ambiguous provider submissions must not be retried or declared free automatically.
  if (!uncertain) await releaseReservation(String(job.reservationId), "script_stage_failed");
 }
}
let running = false;
export function startScriptWorker() {
 const tick = async () => { if (running) return; running = true; try {
  await ScriptJob.updateMany({ status: "processing", leaseUntil: { $exists: false }, createdAt: { $lt: new Date(Date.now() - 240000) } }, { status: "needs_review", error: "This legacy request has no durable checkpoint. Check saved projects and provider records before retrying." });
  await ScriptJob.updateMany({ status: "processing", leaseUntil: { $lt: new Date() }, inFlight: true }, { status: "needs_review", error: "Worker interrupted during a provider request. Saved stages are preserved; review provider billing before retrying." });
  await ScriptJob.updateMany({ status: "processing", leaseUntil: { $lt: new Date() }, inFlight: false }, { status: "queued" });
  const job = await ScriptJob.findOneAndUpdate({ status: "queued" }, { status: "processing", leaseUntil: new Date(Date.now() + 240000), inFlight: false }, { new: true, sort: { createdAt: 1 } });
  if (job) await processScriptJob(job);
 } catch (e) { console.warn("Script worker could not complete a checkpoint", e instanceof Error ? e.message : "Unknown error"); } finally { running = false; } };
 const timer = setInterval(() => void tick(), 3000); timer.unref(); void tick();
}
