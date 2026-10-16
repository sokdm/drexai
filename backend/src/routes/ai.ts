import { researchAgentRouter } from "./researchAgent.js";
import { providerFor } from "../services/openrouter.js";
import { resolveChannel, searchVideos } from "../services/youtube.js";
import { defaultModel } from "../services/platformControl.js";
import { env } from "../config/env.js";
import { rememberQuote, approvedTerms } from "../services/managedPricing.js";
import rateLimit from "express-rate-limit";
import { Router } from "express";
import { z } from "zod";
import { AIConversation } from "../models/AIConversation.js";
import { AIProject } from "../models/AIProject.js";
import { AIUsage } from "../models/AIUsage.js";
import { CharacterProfile } from "../models/CharacterProfile.js";
import { Niche } from "../models/Niche.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { channelAnalysisSchema, geminiJson, geminiText, scriptProjectSchema } from "../services/gemini.js";
import { createQuote, releaseReservation, reserveCredits, settleReservation } from "../services/wallet.js";
import { randomToken } from "../utils/crypto.js";

export const aiRouter = Router();
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
aiRouter.use(requireAuth, requireCsrf, limiter);
aiRouter.use(researchAgentRouter);

async function quoteOrReject(feature: string, approvedCredits?: number, userId?: any) {
  const quote = await approvedTerms(userId, { feature }, approvedCredits!, async () => createQuote({ feature, provider: providerFor(await defaultModel(feature, await defaultModel("text", env.GEMINI_MODEL))), model: await defaultModel(feature, await defaultModel("text", env.GEMINI_MODEL)), quantity: 1 }));
  if (!quote.allowed) throw new Error(quote.reason ?? "AI pricing is unavailable");
  if (approvedCredits !== quote.credits) throw new Error(`Approve ${quote.credits} credit before running this AI action`);
  return quote;
}

aiRouter.post("/quote", async (req, res) => {
  const feature = String(req.body.feature);
  res.json({ quote: await rememberQuote(req.user._id, { feature: req.body.feature }, await createQuote({ feature: req.body.feature, provider: providerFor(await defaultModel(feature, await defaultModel("text", env.GEMINI_MODEL))), model: await defaultModel(feature, await defaultModel("text", env.GEMINI_MODEL)), quantity: 1 })) });
});

aiRouter.post("/chat", async (req, res, next) => {
  let reservation: any;
  try {
    const input = z.object({ conversationId: z.string().optional(), message: z.string().min(2), projectId: z.string().optional(), nicheId: z.string().optional(), approvedCredits: z.number() }).parse(req.body);
    const quote = await quoteOrReject("ai_research_chat", input.approvedCredits, req.user._id);
    reservation = await reserveCredits(String(req.user._id), quote, `ai-chat:${randomToken(8)}`);
    const conversation = input.conversationId ? await AIConversation.findOne({ _id: input.conversationId, userId: req.user._id }) : await AIConversation.create({ userId: req.user._id, projectId: input.projectId, nicheId: input.nicheId, messages: [] });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    conversation.messages.push({ role: "user", content: input.message });
    const context = await loadContext(String(req.user._id), input.projectId, input.nicheId);
    const answer = await geminiText({ model: quote.model, userId: String(req.user._id), requestLimits: (quote as any).requestLimits,
      system: "You are Drex AI, a YouTube research and story-development assistant. Be practical, original, and label inferences. Do not invent private analytics.",
      prompt: `Context:\n${JSON.stringify(context)}\n\nConversation:\n${conversation.messages.map((m: any) => `${m.role}: ${m.content}`).join("\n")}\n\nAnswer the latest user message.`
    });
    conversation.messages.push({ role: "assistant", content: answer });
    await conversation.save();
    await settleReservation(String(reservation._id));
    await AIUsage.create({ userId: req.user._id, model: quote.model, provider: providerFor(quote.model), feature: "ai_research_chat", creditsQuoted: quote.credits, creditsCharged: quote.credits });
    res.json({ conversation, answer });
  } catch (error) {
    if (reservation?._id) await releaseReservation(String(reservation._id), "ai_chat_failed").catch(() => null);
    next(error);
  }
});

aiRouter.post("/analyze-channel", async (req, res, next) => {
  let reservation: any;
  try {
    const input = z.object({ channel: z.any(), uploads: z.array(z.any()).default([]), approvedCredits: z.number() }).parse(req.body);
    const quote = await quoteOrReject("ai_channel_analysis", input.approvedCredits, req.user._id);
    reservation = await reserveCredits(String(req.user._id), quote, `ai-channel:${input.channel?.id ?? randomToken(6)}:${randomToken(4)}`);
    const source = await resolveChannel(String(input.channel?.id || ""));
    const competitors = await searchVideos({ q: source.channel.topics?.map((t: string) => decodeURIComponent(t.split("/").pop() || "").replaceAll("_", " ")).slice(0, 2).join(" ") || source.uploads[0]?.title || source.channel.title, maxResults: 12, order: "relevance" });
    const analysis = await geminiJson({ model: quote.model, userId: String(req.user._id), requestLimits: (quote as any).requestLimits,
      schema: channelAnalysisSchema,
      system: "Analyze only the supplied server-verified public YouTube metadata. Research topics, competitor performance, content gaps, keywords, audience interests and underserved video ideas. Include actionable contentBriefs with hooks and outlines, evidence-based contentGaps and keywords. Label interests, trends and gaps as limited-sample inferences. Lifetime views do not measure growth. Never invent CTR, revenue, watch time, search volume or audience analytics.",
      prompt: `Return an object containing mainNiche (string), contentThemes (string array), commonVideoFormats (string array), publishingPatterns (string), popularTopics (string array), audiencePositioningInference (string), titlePatterns (string array), creativeOpportunities (string array), potentialNicheIdeas (array of {name,rationale}), limitations (string array), keywords (string array), audienceInterests (string array), contentGaps (array of {topic,evidence,opportunity}), and contentBriefs (array of {title,audience,hook,outline:string[],keywords:string[],rationale}). Analyze this channel for YouTube automation research:\n${JSON.stringify({ ...source, competitors: competitors.items.filter((v: any) => v.channelId !== source.channel.id) })}`
    });
    await settleReservation(String(reservation._id));
    await AIUsage.create({ userId: req.user._id, model: quote.model, provider: providerFor(quote.model), feature: "ai_channel_analysis", creditsQuoted: quote.credits, creditsCharged: quote.credits, metadata: { channelId: input.channel?.id } });
    res.json({ analysis, evidence: { channel: source.channel, uploads: source.uploads, competitors: competitors.items.filter((v: any) => v.channelId !== source.channel.id), retrievedAt: new Date(), note: "Public metadata snapshot. Lifetime views are not period growth. Audience interests and opportunities are AI inferences from a limited sample." } });
  } catch (error) {
    if (reservation?._id) await releaseReservation(String(reservation._id), "ai_channel_failed").catch(() => null);
    next(error);
  }
});

aiRouter.get("/niches", async (req, res) => res.json({ niches: await Niche.find({ userId: req.user._id }).sort({ updatedAt: -1 }) }));

const nicheInput = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().max(3000).optional(),
  category: z.string().trim().max(100).optional(), audience: z.string().max(200).optional(),
  contentStyle: z.string().max(100).optional(), language: z.string().max(200).optional(),
  preferredVideoDuration: z.string().max(200).optional(), visualStyle: z.string().max(200).optional(),
  storytellingStyle: z.string().max(200).optional()
});

aiRouter.post("/niches", async (req, res, next) => {
  try {
    const niche = await Niche.create({ ...nicheInput.parse(req.body), userId: req.user._id });
    res.status(201).json({ niche });
  } catch (error) { next(error); }
});

aiRouter.patch("/niches/:id", async (req, res, next) => {
  try {
    const niche = await Niche.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { $set: nicheInput.partial().parse(req.body) }, { new: true, runValidators: true });
    if (!niche) return res.status(404).json({ error: "Niche not found" });
    res.json({ niche });
  } catch (error) { next(error); }
});
aiRouter.delete("/niches/:id", async (req, res) => { await Niche.deleteOne({ _id: req.params.id, userId: req.user._id }); res.json({ ok: true }); });
aiRouter.post("/niches/:id/duplicate", async (req, res) => {
  const original = await Niche.findOne({ _id: req.params.id, userId: req.user._id }).lean();
  if (!original) return res.status(404).json({ error: "Niche not found" });
  const { _id, createdAt, updatedAt, ...copy } = original as any;
  res.status(201).json({ niche: await Niche.create({ ...copy, name: `${copy.name} Copy`, selected: false }) });
});
aiRouter.post("/niches/:id/select", async (req, res) => {
  if (!await Niche.exists({ _id: req.params.id, userId: req.user._id })) return res.status(404).json({ error: "Niche not found" });
  await Niche.updateMany({ userId: req.user._id }, { selected: false });
  res.json({ niche: await Niche.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { selected: true }, { new: true }) });
});

aiRouter.get("/projects", async (req, res) => res.json({ projects: await AIProject.find({ userId: req.user._id }).sort({ updatedAt: -1 }) }));
aiRouter.get("/projects/:id", async (req, res) => res.json({ project: await AIProject.findOne({ _id: req.params.id, userId: req.user._id }) }));

aiRouter.post("/scripts/generate", async (req, res, next) => {
  let reservation: any;
  try {
    const input = z.object({
      approvedCredits: z.number(),
      settings: z.object({
        storyTopic: z.string(), nicheId: z.string().optional(), genre: z.string().optional(), language: z.string().default("English"),
        targetDuration: z.string().optional(), numberOfCharacters: z.number().optional(), visualStyle: z.string().optional(),
        dialoguePreference: z.string().optional(), audience: z.string().optional(), tone: z.string().optional(), type: z.string().optional()
      })
    }).parse(req.body);
    const quote = await quoteOrReject("story_generation", input.approvedCredits, req.user._id);
    reservation = await reserveCredits(String(req.user._id), quote, `story:${randomToken(8)}`);
    const niche = input.settings.nicheId ? await Niche.findOne({ _id: input.settings.nicheId, userId: req.user._id }) : null;
    const generated = await geminiJson({
      model: quote.model, userId: String(req.user._id), requestLimits: (quote as any).requestLimits, maxOutputTokens: 12000,
      schema: scriptProjectSchema,
      system: "Create original, structured YouTube scripts. Return a JSON object with title, storyConcept, summary, characters (array) and scenes (array). Each scene must include order (number), title, sceneDescription, characters (string array), narration, dialogue, imagePrompt, videoMotionPrompt, cameraDirection, estimatedNarrationTiming, audioSuggestions and transitionSuggestions. Keep the existing string fields for compatibility. Also include dialogueLines as an ordered array of objects {speaker, text, language, accent, emotion, delivery}, dialogueLanguage, preferredAccent, emotionAndDelivery, characterActions, cameraPosition, cameraMovements, environmentalSounds, soundEffects, backgroundAmbience, estimatedDurationSeconds (number), visibleSpeakingCharacters (boolean), offscreenNarration (boolean). Identify every speaker and quote exact intended speech. Each dialogue scene must fit an eight-second Veo native audiovisual clip, at most 14 spoken words; divide longer conversations into sequential scenes. Do not put the same speech in narration and dialogue. Set offscreenNarration true only for a separate narrator. Voice preferences are descriptive guidance, never guaranteed cloning. Keep the result to at most 12 practical scenes. Keep content appropriate for a general audience.",
      prompt: `Generate a structured project with scene-level prompts. Settings: ${JSON.stringify(input.settings)}\nNiche: ${JSON.stringify(niche)}`
    });
    const project = await AIProject.create({
      userId: req.user._id,
      nicheId: input.settings.nicheId,
      title: generated.title,
      storyConcept: generated.storyConcept,
      summary: generated.summary,
      type: input.settings.type,
      language: input.settings.language,
      targetDuration: input.settings.targetDuration,
      visualStyle: input.settings.visualStyle,
      selectedVisualStyle: input.settings.visualStyle,
      scenes: generated.scenes,
      prompts: { sourceSettings: input.settings }
    });
    for (const character of generated.characters ?? []) await CharacterProfile.create({ userId: req.user._id, projectId: project._id, ...character });
    await settleReservation(String(reservation._id));
    await AIUsage.create({ userId: req.user._id, model: quote.model, provider: providerFor(quote.model), feature: "story_generation", creditsQuoted: quote.credits, creditsCharged: quote.credits, metadata: { projectId: project._id } });
    res.status(201).json({ project });
  } catch (error) {
    if (reservation?._id) await releaseReservation(String(reservation._id), "story_failed").catch(() => null);
    next(error);
  }
});

aiRouter.patch("/projects/:id/scenes", async (req, res) => {
  const project = await AIProject.findOne({ _id: req.params.id, userId: req.user._id });
  if (!project) return res.status(404).json({ error: "Project not found" });
  const validated = z.array(scriptProjectSchema.shape.scenes.element.partial().extend({ order: z.number().int().positive(), _id: z.string().regex(/^[a-f\d]{24}$/i).optional(), approved: z.boolean().optional() })).min(1).max(50).safeParse(req.body.scenes);
  if (!validated.success) return res.status(400).json({ error: "Review the scene fields before saving: " + validated.error.issues[0].path.join(".") });
  const scenes = validated.data;
  project.versions.push({ label: `Version ${project.versions.length + 1}`, scenes: project.scenes });
  project.scenes = scenes as any;
  project.approvedAt = undefined;
  project.aiStudioReadyAt = undefined;
  project.scenes.forEach(scene => { scene.approved = false; });
  await project.save();
  res.json({ project });
});

aiRouter.post("/projects/:id/approve", async (req, res) => res.json({ project: await AIProject.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { approvedAt: new Date(), "scenes.$[].approved": true }, { new: true }) }));
aiRouter.post("/projects/:id/continue-ai-studio", async (req, res) => res.json({ project: await AIProject.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { aiStudioReadyAt: new Date() }, { new: true }) }));

aiRouter.get("/characters", async (req, res) => res.json({ characters: await CharacterProfile.find({ userId: req.user._id }).sort({ updatedAt: -1 }) }));
aiRouter.post("/characters", async (req, res) => res.status(201).json({ character: await CharacterProfile.create({ ...req.body, userId: req.user._id }) }));
aiRouter.patch("/characters/:id", async (req, res) => res.json({ character: await CharacterProfile.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, req.body, { new: true }) }));
aiRouter.delete("/characters/:id", async (req, res) => { await CharacterProfile.deleteOne({ _id: req.params.id, userId: req.user._id }); res.json({ ok: true }); });

async function loadContext(userId: string, projectId?: string, nicheId?: string) {
  const [project, niche] = await Promise.all([
    projectId ? AIProject.findOne({ _id: projectId, userId }) : null,
    nicheId ? Niche.findOne({ _id: nicheId, userId }) : Niche.findOne({ userId, selected: true })
  ]);
  return { project, niche };
}
