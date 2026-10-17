import { randomUUID } from "node:crypto";
import { sliceKeyframes, timelineSchema, timelineDuration, clipStart, trackStart, type EditorTimeline } from "@drex/shared";
export function speechRanges(log: string, duration: number, padding = .12) {
  const silence: [number, number][] = []; let start = 0;
  for (const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const time = Math.min(duration, Number(match[2]));
    if (match[1] === "start") start = time;
    else if (time > start) silence.push([start, time]);
  }
  if (/silence_start/.test(log) && log.lastIndexOf("silence_start") > log.lastIndexOf("silence_end")) silence.push([start, duration]);
  let cursor = 0; const ranges: [number, number][] = [];
  for (const [from, to] of silence) { const end = Math.min(duration, from + padding); if (end - cursor >= .1) ranges.push([cursor, end]); cursor = Math.max(cursor, to - padding); }
  if (duration - cursor >= .1) ranges.push([cursor, duration]);
  return ranges;
}
// Slice every track against the same retained intervals. Anchors are flattened first.
export function retainTimelineRanges(input: EditorTimeline, ranges: [number, number][]) {
  const original = timelineSchema.parse(input), total = timelineDuration(original);
  let previous = 0;
  for (const [start, end] of ranges) { if (start < previous || end <= start || end > total + .001) throw new Error("Invalid retained timeline intervals"); previous = end; }
  if (!ranges.length) throw new Error("The entire selection is silent. No changes applied.");
  const result: EditorTimeline = { ...original, clips: [], audio: [], captions: [] }; let offset = 0;
  for (const [from, to] of ranges) {
    for (const c of original.clips) {
      const at = clipStart(original, c.id), start = Math.max(from, at), end = Math.min(to, at + c.duration);
      if (end <= start) continue;
      if (end - start < .1) throw new Error("A silence cut leaves a fragment shorter than 0.1 seconds. Adjust clip boundaries and retry.");
      result.clips.push({ ...c, keyframes: sliceKeyframes(c, start - at, end - at), id: randomUUID(), sourceIn: c.sourceIn + (c.kind === "video" ? (start - at) * (c.speed ?? 1) : 0), duration: end - start, transition: "cut" });
    }
    for (const a of original.audio) {
      const at = trackStart(original, a), start = Math.max(from, at), end = Math.min(to, at + a.duration);
      if (end - start < .1) continue;
      result.audio.push({ ...a, id: randomUUID(), anchorClipId: undefined, start: offset + start - from, sourceIn: a.sourceIn + start - at, duration: end - start, fadeIn: 0, fadeOut: 0 });
    }
    for (const c of original.captions) {
      const at = trackStart(original, c), start = Math.max(from, at), end = Math.min(to, at + c.end - c.start);
      if (end <= start) continue;
      result.captions.push({ ...c, id: randomUUID(), anchorClipId: undefined, start: offset + start - from, end: offset + end - from });
    }
    offset += to - from;
  }
  if (result.clips.length > 200) throw new Error("Too many silence cuts. Increase the minimum silence duration.");
  return timelineSchema.parse(result);
}
