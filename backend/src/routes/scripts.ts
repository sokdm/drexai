import {freeChatTerms,admitChatMessage,publicChatError} from "../services/chatAccess.js";
import { Router } from "express";
import { z } from "zod";
import { ScriptJob } from "../models/ScriptJob.js";
import { AIProject } from "../models/AIProject.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { signedImageUrl } from "../services/mediaStorage.js";
import { defaultModel } from "../services/platformControl.js";
import { createQuote, reserveCredits, releaseReservation } from "../services/wallet.js";
import { rememberQuote, approvedTerms } from "../services/managedPricing.js";
import { scriptSettings, scriptShape } from "../services/scriptProduction.js";
import { env } from "../config/env.js";
import { AIConversation } from "../models/AIConversation.js";
export const scriptsRouter = Router();
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch((e:any)=>{if(req.body?.projectId&&req.body?.message)return res.status(e.statusCode||503).json({error:publicChatError(e),resetsAt:e.resetsAt});next(e);});
const id = z.string().regex(/^[a-f0-9]{24}$/i);
const inputSchema = z.object({ settings: scriptSettings, projectId: id.optional(), message: z.string().trim().min(2).max(2000).optional() });
async function normalize(userId: any, input: any) {
 if (input.settings.product) {
  const product = input.settings.product;
  if (await MediaAsset.countDocuments({ _id: { $in: product.assetIds }, userId, type: "image", deletedAt: null }) !== new Set(product.assetIds).size) throw new Error("Choose your own available product images");
  const { values } = await (await import("../services/creditPricingEngine.js")).getPricingPolicy();
  if (!values.commercialEnabled) throw new Error("Product commercials are disabled by the administrator");
  if (scriptShape(input.settings).seconds > values.commercialMaxSeconds) throw new Error("Commercial duration exceeds the administrator's configured limit");
 }
 if (!input.projectId) return input;
 const project = await AIProject.findOne({ _id: input.projectId, userId });
 if (!project) throw new Error("Project not found");
 const add = input.message?.match(/add\s+(five|[1-9]\d?)\s+scenes/i);
 const count = Math.min(40, project.scenes.length + (add ? add[1].toLowerCase() === "five" ? 5 : Number(add[1]) : 0));
 const longer = /longer/i.test(input.message || "");
 const original = scriptShape(input.settings);
 return { ...input, settings: { ...input.settings, sceneCount: Math.max(1,count), ...(longer ? { targetDuration: Math.min(30, original.seconds / 60 * 1.5) + " minutes" } : {}) } };
}
export async function scriptToolTerms(input: any, userId?: string) {

 const model = await (await import("../services/assistantRouting.js")).assistantModel("story_generation", input.settings.modelMode, userId, scriptShape(input.settings).calls);
 if (!model.startsWith("openrouter/")) throw new Error("Select an OpenRouter model for Story generation in Admin / Providers. Script Builder no longer submits direct-provider requests.");
 return createQuote({ feature: "story_generation", provider: "openrouter", model, quantity: scriptShape(input.settings).calls });
}
scriptsRouter.post("/scripts/quote", wrap(async (req: any, res: any) => { const input = await normalize(req.user._id, inputSchema.parse(req.body)); try{res.json({ quote: await rememberQuote(req.user._id, input, await scriptToolTerms(input, String(req.user._id))), stages: scriptShape(input.settings) });}catch(e:any){if(input.projectId&&input.message)return res.status(e.statusCode||503).json({error:publicChatError(e),resetsAt:e.resetsAt});throw e;} }));
scriptsRouter.post("/scripts/generate", wrap(async (req: any, res: any) => {
 const requestId = z.string().uuid().parse(req.body.requestId), input = await normalize(req.user._id, inputSchema.parse(req.body));
 const prior = await ScriptJob.findOne({ userId: req.user._id, requestId }); if (prior) return res.status(202).json({ job: prior });
 const snapshot = input.projectId ? await AIProject.findOne({ _id: input.projectId, userId: req.user._id }) : null;
 if (input.projectId && !snapshot) return res.status(404).json({ error: "Project not found" });
 const approvedCredits = z.number().nonnegative().parse(req.body.approvedCredits), quote = await approvedTerms(req.user._id, input, approvedCredits, () => scriptToolTerms(input, String(req.user._id)));
 if (quote.feature !== "story_generation" || !quote.allowed || quote.credits !== approvedCredits) throw new Error("Review and approve the full current script quote");

 const reservation = await reserveCredits(String(req.user._id), quote, `script:${req.user._id}:${requestId}`);
 try {
 const job = await ScriptJob.create({ userId: req.user._id, requestId, status: "queued", input: { ...input, snapshot: snapshot?.toObject() }, baseUpdatedAt: snapshot?.updatedAt, quote, reservationId: reservation._id, logs: [{ stage: "waiting", message: "Creation tool approved. Waiting for the script worker.", at: new Date() }] });
 res.status(202).json({ job });
 } catch (e: any) { if (e.code === 11000) return res.status(202).json({ job: await ScriptJob.findOne({ userId: req.user._id, requestId }) }); await releaseReservation(String(reservation._id), "script_setup_failed"); throw e; }
}));
scriptsRouter.get("/scripts/jobs/:id", wrap(async (req: any, res: any) => {
 const job = await ScriptJob.findOne({ _id: id.parse(req.params.id), userId: req.user._id });
 if (!job) return res.status(404).json({ error: "Script request not found" });
 res.json({ job, project: await AIProject.findOne({ _id: job.projectId || job.resultProjectId, userId: req.user._id }) });
}));
scriptsRouter.get("/scripts/history", wrap(async (req: any, res: any) => {
 const projectId = id.parse(req.query.projectId);
 if (!await AIProject.exists({ _id: projectId, userId: req.user._id })) return res.status(404).json({ error: "Project not found" });
 res.json({ jobs: await ScriptJob.find({ userId: req.user._id, $or: [{ projectId }, { resultProjectId: projectId }, { "input.projectId": projectId }] }).select("status logs error input.message").sort({ createdAt: -1 }).limit(10), conversations: await AIConversation.find({ userId: req.user._id, projectId, title: "Script revision" }).select("messages").sort({ createdAt: -1 }).limit(10) });
}));
scriptsRouter.get("/projects/:id/scene-images", wrap(async (req: any, res: any) => {
 if (!await AIProject.exists({ _id: id.parse(req.params.id), userId: req.user._id })) return res.status(404).json({ error: "Project not found" });
 const assets = await MediaAsset.find({ userId: req.user._id, projectId: req.params.id, type: "image", deletedAt: null, sceneId: { $exists: true } }).sort({ createdAt: -1 }).limit(200);
 res.json({ assets: await Promise.all(assets.map(async a => ({ sceneId: a.sceneId, _id: a._id, url: a.url?.startsWith("data:") ? a.url : await signedImageUrl(a.key) }))) });
}));
