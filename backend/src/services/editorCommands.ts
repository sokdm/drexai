import { randomUUID } from "node:crypto";
import { timelineSchema, timelineDuration, type EditorTimeline } from "@drex/shared";
export function editingCommand(input: EditorTimeline, message: string, captions: any[] = []): {timeline:EditorTimeline;explanation:string} {
 const timeline = timelineSchema.parse(structuredClone(input)), text = message.trim().toLowerCase(); let result: EditorTimeline = timeline, explanation = "";
 // Compose the reference assistant's common request through the existing tools.
 // Both stages operate on a clone; a failed stage cannot commit a partial edit.
 if (/cinematic/.test(text) && /caption|subtitle/.test(text) && !/silent|silence/.test(text)) {
  const visual = editingCommand(input, /smooth|seamless|join|dissolve/.test(text) ? "smooth joins" : "cinematic", captions);
  const graded = /smooth|seamless|join|dissolve/.test(text) ? editingCommand(visual.timeline,"cinematic",captions) : visual;
  const captioned = editingCommand(graded.timeline,"add captions",captions);
  return {timeline:captioned.timeline,explanation:[visual.explanation,graded===visual?"":graded.explanation,captioned.explanation].filter(Boolean).join(" ")};
 }
 if (/silent|silence/.test(text)) throw new Error("This command requires analysis or effects that this editing assistant does not yet support. No timeline changes were made.");
 if (/smooth|seamless|join|joing|blend|dissolve|cross.?fade|better animations/.test(text)) {
  result.clips=result.clips.map((c,i)=>({...c,transition:i<result.clips.length-1?'dissolve':'cut'}));
  explanation='Applied real dissolve joins without shortening the timeline or shifting dialogue/captions. Each boundary blends the preceding final frame into the next shot. Review visual continuity; unrelated poses or camera angles can still reveal a cut.';
 } else if (/speed|slow motion|faster|slower/.test(text)) {
  const speed=Number(text.match(/([0-9]+(?:\.[0-9]+)?)\s*x/)?.[1]||(/slow/.test(text)?'.75':'1.25'));
  if(speed<.25||speed>4)throw new Error('Choose playback speed between 0.25x and 4x.');
  // Keep clip boundaries and anchored speech stable; faster clips need sufficient source handles.
  result.clips=result.clips.map(c=>c.kind==='video'?{...c,speed}:c);
  explanation='Updated video playback speed while keeping timeline boundaries. Source handles are validated before applying; separately generated speech remains unchanged.';
 } else if (/outro|to be continued/.test(text)) {
  const title=/to be continued/.test(text)?'To be continued?':message.match(/["\u201c](.+?)["\u201d]/)?.[1]||'Thanks for watching';
  result.clips.push({id:randomUUID(),label:'Outro',kind:'title',sourceIn:0,duration:3,transition:'fade',fit:'contain',text:title.slice(0,150),textStyle:{font:'Arial',size:48,position:'center',preset:'bold',animation:'fade'}});
  explanation='Added an editable movie outro title. Existing clips, dialogue and captions were preserved.';
 } else if (/zoom in|slow zoom|pan left|pan right/.test(text)) {
  result.clips = result.clips.map(c => ({ ...c, keyframes: [{ time: 0, zoom: /pan/.test(text) ? 1.3 : 1, x: /pan left/.test(text) ? 1 : /pan right/.test(text) ? 0 : .5, y: .5 }, { time: c.duration, zoom: /pan/.test(text) ? 1.3 : 1.2, x: /pan left/.test(text) ? 0 : /pan right/.test(text) ? 1 : .5, y: .5 }] }));
  explanation = "Saved interpolated pan/zoom keyframes on each clip. Preview or undo the motion before exporting. This motion does not detect or track speakers.";
 } else if (/professional/.test(text)) {
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
  result.overlays = result.overlays?.map(o => ({...o,start:o.start+seconds}));
  result.audio = result.audio.map(a => a.anchorClipId ? a : { ...a, start: a.start + seconds }); result.captions = result.captions.map(c => c.anchorClipId ? c : { ...c, start: c.start + seconds, end: c.end + seconds });
  explanation = "Added a three-second title card and shifted unanchored audio and captions.";
 } else if (/short|vertical|9:16/.test(text)) {
  const duration = Math.min(600, Math.max(1, Number(text.match(/(\d+)\s*(?:second|sec|s\b)/)?.[1] || 30))); let remaining = duration;
  result.clips = result.clips.flatMap(clip => { if (remaining < .1) return []; const next = { ...clip, duration: Math.min(clip.duration, remaining), fit: "cover" as const }; remaining -= next.duration; return [next]; });
  const ids = new Set(result.clips.map(c => c.id)), end = timelineDuration(result); result.aspectRatio = "9:16";
  result.overlays = result.overlays?.filter(o => o.start < end-.1).map(o => ({...o,duration:Math.min(o.duration,end-o.start)}));
  result.audio = result.audio.filter(a => a.anchorClipId ? ids.has(a.anchorClipId) : a.start < end).map(a => ({ ...a, duration: Math.min(a.duration, Math.max(.1, end - (a.anchorClipId ? 0 : a.start))), fadeIn: 0, fadeOut: 0 }));
  result.captions = result.captions.filter(c => c.anchorClipId ? ids.has(c.anchorClipId) : c.start < end).map(c => ({ ...c, end: Math.min(c.end, c.anchorClipId ? c.end : end) }));
  explanation = `Kept the first ${duration} seconds and changed to a vertical cover composition. This command does not detect speakers or rank engaging moments.`;
 } else if (/mute.*music/.test(text)) { result.audio = result.audio.map(a => a.role === "music" ? { ...a, muted: true } : a); explanation = "Muted background music tracks."; }
 else throw new Error("Supported commands: add fade transitions, animate existing captions, create an intro, make a 30-second vertical short, and mute music. Silence detection, automatic color grading and arbitrary effects require additional processing and are not executed here.");
 return { timeline: timelineSchema.parse(result), explanation };
}
