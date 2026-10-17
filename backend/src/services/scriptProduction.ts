import { z } from "zod";
import { ScriptJob } from "../models/ScriptJob.js";
import { AIProject } from "../models/AIProject.js";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { routerText } from "./openrouter.js";
import { AIConversation } from "../models/AIConversation.js";
import { scriptProjectSchema } from "./gemini.js";
import { settleReservation, releaseReservation } from "./wallet.js";
export const scriptSettings = z.object({ storyTopic: z.string().trim().min(2).max(6000), nicheId: z.preprocess(v => v === "" ? undefined : v, z.string().regex(/^[a-f0-9]{24}$/i).optional()), type: z.string().max(100).default("Animated story"), genre: z.string().max(100).default("Adventure"), language: z.string().max(100).default("English"), targetDuration: z.string().max(50).default("8 minutes"), visualStyle: z.string().max(200).default("Cinematic"), audience: z.string().max(200).default("General audience"), tone: z.string().max(200).default("Engaging"), dialoguePreference: z.string().max(100).optional(), sceneCount: z.number().int().min(3).max(40).optional(), numberOfCharacters: z.number().int().min(1).max(10).optional() });
export function scriptShape(settings: any) { const raw = Number(String(settings.targetDuration).match(/[\d.]+/)?.[0] || 8); const seconds = Math.round(Math.min(1800, Math.max(30, /second/i.test(settings.targetDuration) ? raw : raw * 60))); const scenes = Math.min(40, Math.max(3, settings.sceneCount || Math.ceil(seconds / 30))); return { seconds, scenes, calls: 1 + Math.ceil(scenes / 2) }; }
const planSchema = z.object({ title: z.string(), storyConcept: z.string(), summary: z.string(), characters: scriptProjectSchema.shape.characters, scenes: z.array(z.object({ title: z.string(), purpose: z.string(), duration: z.number().positive() })).min(1).max(40) });
async function log(job: any, stage: string, message: string) { await ScriptJob.updateOne({ _id: job._id }, { $push: { logs: { stage, message, at: new Date() } }, leaseUntil: new Date(Date.now() + 240000) }); }
export async function processScriptJob(job: any, request = routerText) {
 const input = job.input, shape = scriptShape(input.settings), quote = job.quote;
 const invoke = async (schema: any, system: string, prompt: string) => {
  await ScriptJob.updateOne({ _id: job._id }, { inFlight: true, leaseUntil: new Date(Date.now() + 240000) });
  const options = { model: quote.model, userId: String(job.userId), reservationId: String(job.reservationId), requestLimits: quote.requestLimits, schema, maxOutputTokens: Math.min(12000, quote.requestLimits?.maxOutputTokens ?? 5000), reasoningEffort: "low" as const, timeoutMs: 180000, system, prompt };
  let raw: string;
  try { raw = await request(options); }
  catch (e: any) {
   if (!e.providerRejected || ![429, 503].includes(e.status)) throw e;
   await log(job, "retrying", "Provider explicitly rejected this request before generation. Retrying once; ambiguous timeouts are never retried.");
   raw = await request(options);
  }
  const parsed = schema.parse(JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  return parsed;
 };
 try {
  let plan = job.plan, project: any = job.resultProjectId ? await AIProject.findById(job.resultProjectId) : null;
  if (!plan) {
   await log(job, "planning", "Planning the story arc, characters, hook and ending");
   plan = await invoke(planSchema, "Plan an original complete video narrative. Return structured JSON only. Include a hook, developed middle, character motivations and satisfying ending. Do not generate images or call media services.", JSON.stringify({ settings: input.settings, sceneCount: shape.scenes, targetSeconds: shape.seconds, editInstruction: input.message, existing: input.snapshot ? { title: input.snapshot.title, summary: input.snapshot.summary, scenes: input.snapshot.scenes.map((s: any) => ({ title: s.title, narration: s.narration, dialogue: s.dialogue })) } : undefined }));
   if (plan.scenes.length !== shape.scenes) throw new Error("The planning response did not contain the required scene count");
   project = await AIProject.create({ userId: job.userId, title: plan.title, storyConcept: plan.storyConcept, summary: plan.summary, type: input.settings.type, language: input.settings.language, targetDuration: input.settings.targetDuration, visualStyle: input.settings.visualStyle, nicheId: input.settings.nicheId, prompts: { sourceSettings: input.settings, scriptJobId: String(job._id), partial: true }, scenes: [] });
   await ScriptJob.updateOne({ _id: job._id }, { plan, resultProjectId: project._id, inFlight: false });
   for (const character of plan.characters) await CharacterProfile.create({ ...character, userId: job.userId, projectId: project._id });
  }
  if (!project) throw new Error("Saved script draft is missing");
  for (let index = job.cursor || 0; index < plan.scenes.length; index += 2) {
   const count = Math.min(2, plan.scenes.length - index), duration = shape.seconds / shape.scenes;
   await log(job, "writing", `Writing scenes ${index + 1} to ${index + count} of ${plan.scenes.length}`);
   const schema = z.object({ scenes: scriptProjectSchema.shape.scenes });
   const result = await invoke(schema, "Write fully developed original screenplay scenes as JSON. Include narration, attributed dialogue, scene descriptions, camera directions, image prompts, video motion prompts, sound descriptions and transition suggestions. Match language and tone. Narration plus dialogue should contain approximately 120-150 spoken words per minute of scene duration. Do not shorten to a synopsis. Scene lengths describe the edited story, NOT a single provider video clip. Audio and shot prompts are descriptive, not model-specific. Include the hook in the first scene and a complete ending in the last. Do not repeat prior scenes. Keep non-spoken technical directions concise: each image/video prompt under 100 words, other direction fields under 40 words. Supply only the required JSON, without explanations.", JSON.stringify({ settings: input.settings, characters: plan.characters, story: plan.summary, scenes: plan.scenes.slice(index, index + count), startOrder: index + 1, secondsPerScene: duration, precedingScene: project.scenes.at(-1)?.narration || "", instruction: input.message }));
   if (result.scenes.length !== count) throw new Error("The provider returned an incomplete scene batch; completed scenes were preserved");
   const scenes = result.scenes.map((scene: any, i: number) => ({ ...scene, order: index + i + 1, estimatedDurationSeconds: duration }));
   const words = scenes.reduce((n: number, s: any) => n + (s.narration + " " + s.dialogue).split(/\s+/).filter(Boolean).length, 0);
   if (words < duration * count * 1.8) throw new Error("The scene batch is too short for the requested duration; partial work was preserved");
   project.scenes.push(...scenes); await project.save();
   await ScriptJob.updateOne({ _id: job._id }, { cursor: index + count, inFlight: false });
   await log(job, "prompts", `Saved scenes ${index + 1} to ${index + count}, including dialogue and visual prompts`);
  }
  project.prompts = { ...project.prompts, partial: false };
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
   existing.prompts = { ...existing.prompts, partial: false, sourceSettings: input.settings };
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
  const uncertain = /abort|timeout|network|fetch failed/i.test(error.message);
  await log(job, "error", error.message);
  if (error.code === "INCOMPLETE_PROVIDER_OUTPUT") await ScriptJob.updateOne({ _id: job._id }, { outputFailure: { finishReason: error.finishReason, maxOutputTokens: error.maxOutputTokens, usage: error.usage, requestId: error.requestId } });
  await ScriptJob.updateOne({ _id: job._id }, { status: uncertain ? "needs_review" : "failed", error: error.message });
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
