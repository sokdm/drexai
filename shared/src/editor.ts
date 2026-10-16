import { z } from "zod";

const seconds = z.number().finite().min(0).max(3600);
const identifier = z.string().min(1).max(80);
const assetId = z.string().regex(/^[a-f\d]{24}$/i);
export const captionStyleSchema = z.object({ font: z.enum(["Arial", "Georgia", "Courier New"]).default("Arial"), size: z.number().int().min(16).max(96).default(36), position: z.enum(["top", "center", "bottom"]).default("bottom"), preset: z.enum(["clean", "boxed", "bold"]).default("clean"), animation: z.enum(["none", "pop", "fade"]).optional() });
export const editorClipSchema = z.object({
  id: identifier, sceneId: z.string().max(80).optional(), label: z.string().max(150),
  kind: z.enum(["video", "image", "title"]), assetId: assetId.optional(),
  sourceAudio: z.boolean().optional(), sourceVolume: z.number().min(0).max(1).optional(), sourceMuted: z.boolean().optional(), nativeDialogue: z.boolean().optional(),
  cropX: z.number().min(0).max(1).optional(),
  look: z.enum(["original", "cinematic", "vivid", "monochrome", "warm", "cool"]).optional(),
  brightness: z.number().min(-0.5).max(0.5).optional(), contrast: z.number().min(0.5).max(2).optional(), saturation: z.number().min(0).max(2).optional(),
  sharpen: z.number().min(0).max(1.5).optional(), vignette: z.boolean().optional(),
  sourceIn: seconds.default(0), duration: z.number().finite().min(0.1).max(600),
  transition: z.enum(["cut", "fade"]).default("cut"), fit: z.enum(["contain", "cover"]).default("contain"),
  text: z.string().max(500).default(""), textStyle: captionStyleSchema.default({}),
}).superRefine((clip, ctx) => { if (clip.kind !== "title" && !clip.assetId) ctx.addIssue({ code: "custom", message: "Select a source asset" }); });
export const editorAudioSchema = z.object({
  id: identifier, assetId, label: z.string().max(150), role: z.enum(["narration", "dialogue", "music", "sfx"]),
  start: seconds, sourceIn: seconds.default(0), duration: z.number().finite().min(0.1).max(3600),
  volume: z.number().min(0).max(1).default(1), muted: z.boolean().default(false),
  fadeIn: z.number().min(0).max(10).default(0), fadeOut: z.number().min(0).max(10).default(0),
  anchorClipId: identifier.optional(),
});
export const editorCaptionSchema = z.object({ id: identifier, text: z.string().min(1).max(500), start: seconds, end: seconds, anchorClipId: identifier.optional(), verification: z.enum(["transcript", "unverified_script", "manual"]).optional(), style: captionStyleSchema.default({}) }).refine(c => c.end > c.start, "Caption end must follow start");
export const timelineSchema = z.object({
  clips: z.array(editorClipSchema).max(200), audio: z.array(editorAudioSchema).max(200), captions: z.array(editorCaptionSchema).max(1000),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"), musicDecision: z.enum(["pending", "added", "none"]).default("pending"),
}).superRefine((timeline, ctx) => {
  if (timelineDuration(timeline) > 3600) ctx.addIssue({ code: "custom", message: "Timeline cannot exceed one hour" });
  for (const items of [timeline.clips, timeline.audio, timeline.captions]) if (new Set(items.map(i => i.id)).size !== items.length) ctx.addIssue({ code: "custom", message: "Timeline IDs must be unique" });
  const ids = new Set(timeline.clips.map(c => c.id));
  for (const item of [...timeline.audio, ...timeline.captions]) if (item.anchorClipId && !ids.has(item.anchorClipId)) ctx.addIssue({ code: "custom", message: "Audio or caption references a missing clip" });
  for (const a of timeline.audio) if (a.fadeIn + a.fadeOut > a.duration) ctx.addIssue({ code: "custom", message: "Audio fades exceed track duration" });
});
export const exportSettingsSchema = z.object({ format: z.literal("mp4").default("mp4"), resolution: z.enum(["480p", "720p", "1080p"]), quality: z.enum(["draft", "standard", "high"]), filename: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/, "Use letters, numbers, spaces, dots, dashes or underscores").refine(s => !s.includes(".."), "Invalid filename") });
export type EditorTimeline = z.infer<typeof timelineSchema>;
export type EditorClip = z.infer<typeof editorClipSchema>;
export type EditorAudio = z.infer<typeof editorAudioSchema>;
export type EditorCaption = z.infer<typeof editorCaptionSchema>;
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export function timelineDuration(t: { clips: { duration: number }[] }) { return t.clips.reduce((n, c) => n + c.duration, 0); }
export function clipStart(t: { clips: { id: string; duration: number }[] }, id?: string) { let n = 0; for (const c of t.clips) { if (c.id === id) return n; n += c.duration; } return 0; }
export function trackStart(t: EditorTimeline, a: { start: number; anchorClipId?: string }) { return a.start + (a.anchorClipId ? clipStart(t, a.anchorClipId) : 0); }
export function outputDimensions(ratio: EditorTimeline["aspectRatio"], resolution: ExportSettings["resolution"]) { const short = { "480p": 480, "720p": 720, "1080p": 1080 }[resolution]; const long = Math.round(short * 16 / 9 / 2) * 2; return ratio === "1:1" ? [short, short] : ratio === "9:16" ? [short, long] : [long, short]; }
export function splitTimeline(t: EditorTimeline, id: string, localTime: number, newId: string): EditorTimeline {
  const clip = t.clips.find(c => c.id === id);
  if (!clip || localTime < 0.1 || localTime > clip.duration - 0.1) return t;
  return { ...t, clips: t.clips.flatMap(c => c.id !== id ? [c] : [{ ...c, duration: localTime, transition: "cut" as const }, { ...c, id: newId, sourceIn: c.kind === "video" ? c.sourceIn + localTime : c.sourceIn, duration: c.duration - localTime }]) };
}
export function deleteClips(t: EditorTimeline, ids: string[]): EditorTimeline {
  const remove = new Set(ids);
  return { ...t, clips: t.clips.filter(c => !remove.has(c.id)), audio: t.audio.filter(a => !a.anchorClipId || !remove.has(a.anchorClipId)), captions: t.captions.filter(a => !a.anchorClipId || !remove.has(a.anchorClipId)) };
}
