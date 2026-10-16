import { z } from "zod";
import { imageModels, validateImageSettings } from "./imageGeneration.js";
import { videoModels, validateVideoSettings, planClipDurations } from "./videoGeneration.js";
import { ttsModels, validateTtsSettings } from "./textToSpeech.js";

export const studioSettingsSchema = z.object({
  imageModel: z.string().default(imageModels[0].id),
  videoModel: z.string().default(videoModels[0].id),
  voiceModel: z.string().default(ttsModels[0].id),
  aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
  resolution: z.string().default("1K"),
  quality: z.string().default("720p"),
  voiceId: z.string().default("Kore"),
  language: z.string().default("English"),
  style: z.string().max(200).default("cinematic"),
  narration: z.boolean().default(true),
  video: z.boolean().default(true),
  targetSeconds: z.number().int().min(4).max(3600).default(60),
  maxClipsPerScene: z.number().int().min(1).max(12).default(3),
  characterVoices: z.record(z.string(), z.string()).default({})
});
export type StudioSettings = z.infer<typeof studioSettingsSchema>;
export type StudioStep = {
  key: string; sceneId: string; sceneOrder: number; kind: "image" | "audio" | "video";
  label: string; input: Record<string, any>; status: "pending" | "requesting" | "completed" | "skipped" | "failed" | "needs_review";
  credits: number; pricing?: Record<string, any>; assetId?: string; providerJobId?: string;
  stored?: Record<string, any>; error?: string; charged?: boolean; reused?: boolean; failedProviderJobIds?: string[];
};
export type StudioSnapshot = { title: string; scenes: any[]; characters: any[]; niche?: any; summary?: string };

export function buildStudioSteps(snapshot: StudioSnapshot, settings: StudioSettings): StudioStep[] {
  const scenes = [...snapshot.scenes].sort((a, b) => a.order - b.order);
  if (!scenes.length || scenes.length > 50) throw new Error("Production requires 1-50 approved scenes");
  if (new Set(scenes.map(s => s.order)).size !== scenes.length) throw new Error("Scene orders must be unique");
  if (!imageModels.some(m => m.id === settings.imageModel) || !videoModels.some(m => m.id === settings.videoModel) || !ttsModels.some(m => m.id === settings.voiceModel)) throw new Error("Unsupported production model");
  const steps: StudioStep[] = [];
  function add(scene: any, kind: StudioStep["kind"], suffix: string, input: any, label: string) {
    steps.push({ key: `${scene._id}-${kind}${suffix}`, sceneId: String(scene._id), sceneOrder: scene.order, kind, input, label: `Scene ${scene.order}: ${label}`, status: "pending", credits: 0 });
  }
  for (const scene of scenes) {
    if (!scene.approved || !scene._id || !Number.isInteger(scene.order) || !scene.imagePrompt?.trim()) throw new Error("Every scene needs approval, a unique order, and an image prompt");
    const characters = snapshot.characters.filter(c => (scene.characters ?? []).includes(c.name));
    const prompt = [scene.imagePrompt, ...characters.map(c => `Character ${c.name}: ${c.appearance ?? ""}; clothing: ${c.clothing ?? ""}; personality: ${c.personality ?? ""}`)].join("\n");
    const refs = imageModels.find(m => m.id === settings.imageModel)?.characterReference ? characters.map(c => c.referenceAssetId).filter(Boolean) : [];
    add(scene, "image", "", validateImageSettings({ prompt, stylePreset: snapshot.niche?.visualStyle ?? "Cinematic", model: settings.imageModel, aspectRatio: settings.aspectRatio, resolution: settings.resolution, numberOfImages: 1, characterReferenceIds: refs }), "image");
  }
  if (settings.narration) for (const scene of scenes) {
    const segments = [];
    if (scene.narration?.trim()) segments.push({ text: scene.narration.trim(), speaker: "Narrator", track: "narration" });
    if (scene.dialogue?.trim()) for (const line of scene.dialogue.split(/\n+/).filter((s: string) => s.trim())) {
      const match = line.match(/^([^:]{1,80}):\s*(.+)$/);
      segments.push({ text: match ? match[2] : line, speaker: match ? match[1].trim() : "Narrator", track: "dialogue" });
    }
    if (segments.length > 50) throw new Error("A scene supports up to 50 speech segments");
    segments.forEach((segment, index) => {
      const character = snapshot.characters.find(c => c.name === segment.speaker);
      const voiceId = settings.characterVoices[segment.speaker] ?? character?.voicePreference ?? settings.voiceId;
      const input = validateTtsSettings({ ...segment, model: settings.voiceModel, voiceId, language: settings.language, style: settings.style, mode: "single", speakers: [] });
      if (input.text.length > 8000) throw new Error("Split speech segments longer than 8,000 characters before production");
      add(scene, "audio", `-${index}`, input, `${segment.track} (${segment.speaker})`);
    });
  }
  if (settings.video) for (const scene of scenes) {
    if (!scene.videoMotionPrompt?.trim()) throw new Error(`Scene ${scene.order} needs a motion prompt`);
    const durationSeconds = videoModels.find(m => m.id === settings.videoModel)!.durations[0];
    for (let index = 0; index < settings.maxClipsPerScene; index++) add(scene, "video", `-${index}`, validateVideoSettings({ motionPrompt: scene.videoMotionPrompt, sourceImageAssetId: "resolved-at-execution", model: settings.videoModel, aspectRatio: settings.aspectRatio, durationSeconds, quality: settings.quality, quantity: 1, clipIndex: index }), `video clip ${index + 1}`);
  }
  return steps;
}

export function sceneDuration(sceneId: string, steps: StudioStep[], assets: any[], fallbackSeconds: number) {
  const assetIds = new Set(steps.filter(s => s.sceneId === sceneId && s.kind === "audio" && s.status === "completed").map(s => String(s.assetId)));
  const duration = assets.filter(a => assetIds.has(String(a._id))).reduce((sum, asset) => sum + Number(asset.durationSeconds), 0);
  if (!Number.isFinite(duration)) throw new Error("Invalid measured speech duration");
  return duration > 0 ? duration : fallbackSeconds;
}

export function requiredClips(seconds: number, settings: StudioSettings) {
  return Math.min(settings.maxClipsPerScene, planClipDurations(seconds, settings.videoModel).length);
}

export function makeTimeline(snapshot: StudioSnapshot, settings: StudioSettings, steps: StudioStep[], assets: any[]) {
  let offset = 0;
  return [...snapshot.scenes].sort((a, b) => a.order - b.order).map(scene => {
    const id = String(scene._id);
    const completed = steps.filter(s => s.sceneId === id && s.status === "completed");
    const durationSeconds = sceneDuration(id, steps, assets, settings.targetSeconds / snapshot.scenes.length);
    let audioOffset = 0;
    let videoOffset = 0;
    const audio = completed.filter(s => s.kind === "audio").map(step => {
      const asset = assets.find(a => String(a._id) === step.assetId);
      if (!asset || !(asset.durationSeconds > 0)) throw new Error("Missing measured audio asset");
      const entry = { assetId: step.assetId, startSeconds: audioOffset, durationSeconds: asset.durationSeconds, track: step.input.track, speaker: step.input.speaker, voiceId: step.input.voiceId };
      audioOffset += asset.durationSeconds; return entry;
    });
    const clips = completed.filter(s => s.kind === "video").map(step => {
      const asset = assets.find(a => String(a._id) === step.assetId);
      if (!asset || !(asset.durationSeconds > 0)) throw new Error("Missing video asset");
      const length = Math.max(0, Math.min(asset.durationSeconds, durationSeconds - videoOffset));
      const clip = { assetId: step.assetId, startSeconds: videoOffset, durationSeconds: length };
      videoOffset += length; return clip;
    }).filter(clip => clip.durationSeconds > 0);
    const item = { sceneId: id, order: scene.order, title: scene.title, startSeconds: offset, durationSeconds, imageAssetId: completed.find(s => s.kind === "image")?.assetId, clips, audio, holdSeconds: Math.max(0, durationSeconds - videoOffset), transition: "cut", suggestedTransition: scene.transitionSuggestions ?? "cut" };
    offset += durationSeconds; return item;
  });
}
