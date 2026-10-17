import { randomUUID } from "node:crypto";
import { timelineSchema, timelineDuration, type EditorTimeline } from "@drex/shared";
export function editingCommand(input: EditorTimeline, message: string, captions: any[] = []) {
 const timeline = timelineSchema.parse(structuredClone(input)), text = message.trim().toLowerCase(); let result: EditorTimeline = timeline, explanation = "";
 if (/silent|silence|speed/.test(text)) throw new Error("This command requires analysis or effects that this editing assistant does not yet support. No timeline changes were made.");
 if (/professional/.test(text)) {
  result.clips = result.clips.map((c, i) => ({ ...c, look: "cinematic", brightness: undefined, contrast: undefined, saturation: undefined, transition: i < result.clips.length - 1 ? "fade" : "cut" }));
  result.audio = result.audio.map(a => a.role === "music" ? { ...a, volume: Math.min(a.volume, .15) } : a);
  result.captions = result.captions.map(c => ({ ...c, style: { ...c.style, preset: "bold", animation: "pop" } }));
  explanation = "Applied cinematic color, fade-through-black scene boundaries, animated existing captions and lowered existing music to at most 15%. Review the result; no new media was generated.";
 } else if (/cinematic|monochrome|black and white|vivid|warm|cool|vignette|sharpen|reset effects/.test(text)) {
  const look = /reset effects/.test(text) ? "original" : /monochrome|black and white/.test(text) ? "monochrome" : /vivid/.test(text) ? "vivid" : /warm/.test(text) ? "warm" : /cool/.test(text) ? "cool" : /cinematic/.test(text) ? "cinematic" : undefined;
  result.clips = result.clips.map(c => ({ ...c, ...(look ? { look, brightness: undefined, contrast: undefined, saturation: undefined } : {}), ...(/vignette/.test(text) ? { vignette: true } : {}), ...(/sharpen/.test(text) ? { sharpen: .6 } : {}), ...(/reset effects/.test(text) ? { sharpen: 0, vignette: false } : {}) }));
  explanation = "Updated clip color/effect settings. Preview the color changes and export through FFmpeg to render sharpening and vignette.";
  if (/transition/.test(text)) { result.clips = result.clips.map((c, i) => ({ ...c, transition: i < result.clips.length - 1 ? "fade" : "cut" })); explanation += " Added fade-through-black transitions."; }
 } else if (/transition/.test(text)) {
  result.clips = result.clips.map((clip, i) => ({ ...clip, transition: i === result.clips.length - 1 ? "cut" : "fade" }));
  explanation = "Applied supported fade transitions. Color grading and cinematic effects were not added.";
 } else if (/caption|subtitle/.test(text)) {
  if (!captions.length && !timeline.captions.length) throw new Error("No reviewed transcript or captions are saved. Add a transcript or manual captions first; speech has not been transcribed by this command.");
  result.captions = (timeline.captions.length ? timeline.captions : captions).map(c => ({ ...c, style: { ...c.style, animation: /animat|pop/.test(text) ? "pop" : c.style.animation || "none", preset: "bold" } }));
  explanation = "Updated real caption tracks. Review their timing and animation in preview before exporting.";
 } else if (/intro/.test(text)) {
  const title = message.match(/["“](.+?)["”]/)?.[1] || "Welcome";
  const seconds = 3; result.clips.unshift({ id: randomUUID(), label: "Intro", kind: "title", sourceIn: 0, duration: seconds, transition: "fade", fit: "contain", text: title.slice(0, 150), textStyle: { font: "Arial", size: 48, position: "center", preset: "bold", animation: "fade" } });
  result.audio = result.audio.map(a => a.anchorClipId ? a : { ...a, start: a.start + seconds }); result.captions = result.captions.map(c => c.anchorClipId ? c : { ...c, start: c.start + seconds, end: c.end + seconds });
  explanation = "Added a three-second title card and shifted unanchored audio and captions.";
 } else if (/short|vertical|9:16/.test(text)) {
  const duration = Math.min(600, Math.max(1, Number(text.match(/(\d+)\s*(?:second|sec|s\b)/)?.[1] || 30))); let remaining = duration;
  result.clips = result.clips.flatMap(clip => { if (remaining < .1) return []; const next = { ...clip, duration: Math.min(clip.duration, remaining), fit: "cover" as const }; remaining -= next.duration; return [next]; });
  const ids = new Set(result.clips.map(c => c.id)), end = timelineDuration(result); result.aspectRatio = "9:16";
  result.audio = result.audio.filter(a => a.anchorClipId ? ids.has(a.anchorClipId) : a.start < end).map(a => ({ ...a, duration: Math.min(a.duration, Math.max(.1, end - (a.anchorClipId ? 0 : a.start))), fadeIn: 0, fadeOut: 0 }));
  result.captions = result.captions.filter(c => c.anchorClipId ? ids.has(c.anchorClipId) : c.start < end).map(c => ({ ...c, end: Math.min(c.end, c.anchorClipId ? c.end : end) }));
  explanation = `Kept the first ${duration} seconds and changed to a vertical cover composition. This command does not detect speakers or rank engaging moments.`;
 } else if (/mute.*music/.test(text)) { result.audio = result.audio.map(a => a.role === "music" ? { ...a, muted: true } : a); explanation = "Muted background music tracks."; }
 else throw new Error("Supported commands: add fade transitions, animate existing captions, create an intro, make a 30-second vertical short, and mute music. Silence detection, automatic color grading and arbitrary effects require additional processing and are not executed here.");
 return { timeline: timelineSchema.parse(result), explanation };
}
