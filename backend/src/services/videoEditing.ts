import { randomUUID } from "node:crypto";
import { EditorTimeline, timelineSchema, timelineDuration, trackStart, outputDimensions, ExportSettings } from "@drex/shared";
import { MediaAsset } from "../models/MediaAsset.js";
import { readMediaObject, signedImageUrl, uploadAudio, persistentStorageConfigured } from "./mediaStorage.js";
import { readSourceImage } from "./sourceImages.js";
import { probeMedia } from "./ffmpeg.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export const editorFail = (message: string, statusCode = 400): never => { throw Object.assign(new Error(message), { statusCode }); };
export function roughCut(production: any): EditorTimeline {
  const clips: any[] = [], audio: any[] = [];
  for (const scene of production.timeline ?? []) {
    const first = clips.length;
    let coverage = 0;
    for (const clip of scene.clips ?? []) {
      const duration = Math.min(clip.durationSeconds, scene.durationSeconds - coverage);
      if (duration < 0.1) continue;
      clips.push({ id: randomUUID(), sceneId: scene.sceneId, label: scene.title || "Scene", kind: "video", assetId: clip.assetId, sourceAudio: clip.nativeAudio === true || !(scene.audio ?? []).some((a: any) => a.track === "dialogue"), sourceVolume: 1, sourceMuted: false, nativeDialogue: clip.nativeDialogue === true, sourceIn: 0, duration, transition: "cut", text: "" }); coverage += duration;
    }
    if (coverage < scene.durationSeconds - 0.05 && scene.imageAssetId) clips.push({ id: randomUUID(), sceneId: scene.sceneId, label: scene.title || "Scene", kind: "image", assetId: scene.imageAssetId, sourceIn: 0, duration: scene.durationSeconds - coverage, transition: "cut", text: "" });
    if (clips.length === first) editorFail(`Scene ${scene.title || scene.sceneId} has no generated visuals`);
    if (timelineDuration({ clips: clips.slice(first) }) < scene.durationSeconds - 0.05) editorFail("Generate a still image to cover the end of this scene before editing");
    for (const a of scene.audio ?? []) audio.push({ id: randomUUID(), anchorClipId: clips[first].id, assetId: a.assetId, role: a.track === "dialogue" ? "dialogue" : "narration", label: `${a.speaker || "Narrator"} · ${scene.title || "Scene"}`, start: a.startSeconds, sourceIn: 0, duration: a.durationSeconds, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 });
  }
  if (!clips.length) editorFail("This production has no rough cut yet");
  return timelineSchema.parse({ clips, audio, captions: [], aspectRatio: production.settings?.aspectRatio || "16:9", musicDecision: "pending" });
}
export async function validateTimelineAssets(timeline: EditorTimeline, userId: string, settings?: ExportSettings) {
  const ids = [...new Set([...timeline.clips.map(c => c.assetId), ...timeline.audio.map(a => a.assetId)].filter(Boolean))];
  const assets = await MediaAsset.find({ _id: { $in: ids }, userId, deletedAt: null }).lean();
  if (assets.length !== ids.length) editorFail("A timeline asset is missing or belongs to another user", 404);
  const map = new Map(assets.map(a => [String(a._id), a]));
  const total = timelineDuration(timeline);
  for (const c of timeline.clips) {
    if (c.kind === "title") continue;
    const asset = map.get(c.assetId!)!;
    if (asset.type !== c.kind) editorFail("Clip type does not match its source");
    if (c.kind === "video" && asset.durationSeconds && c.sourceIn + c.duration > asset.durationSeconds + 0.05) editorFail(`Trim exceeds source duration: ${c.label}`);
    if (settings && asset.width && asset.height) {
      const [w, h] = outputDimensions(timeline.aspectRatio, settings.resolution);
      const scale = c.fit === "cover" ? Math.max(w / asset.width, h / asset.height) : Math.min(w / asset.width, h / asset.height);
      if (scale > 1.01) editorFail(`Choose a lower resolution for ${c.label}; source upscaling is disabled`);
    }
  }
  for (const a of timeline.audio) {
    const asset = map.get(a.assetId)!;
    if (asset.type !== "audio") editorFail("Audio track requires an audio asset");
    if (asset.durationSeconds && a.sourceIn + a.duration > asset.durationSeconds + 0.05) editorFail(`Audio trim exceeds source duration: ${a.label}`);
    if (trackStart(timeline, a) + a.duration > total + 0.1) editorFail(`Audio extends past the timeline: ${a.label}. Shorten or reposition it.`);
    if (a.role === "music" && !asset.metadata?.licenseConfirmed && !asset.metadata?.licenseUrl) editorFail("Confirm permission to use this music");
  }
  for (const c of timeline.captions) if (trackStart(timeline, c) + c.end - c.start > total + 0.1) editorFail("A caption extends past the timeline");
  return assets;
}
export async function editorAssetBytes(asset: any) {
  if (asset.storageProvider === "local-upload") return (await readSourceImage(asset)).buffer;
  if (asset.url?.startsWith("data:")) {
    const match = asset.url.match(/^data:(?:image|audio|video)\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) editorFail("Invalid inline media");
    return Buffer.from(match![1], "base64");
  }
  const object = await readMediaObject(asset.key);
  if (!object) editorFail("Source media is no longer stored", 404);
  return object!.buffer;
}
export async function editorAssetUrl(asset: any) {
  if (asset.storageProvider === "local-upload") return `/api/videos/source-images/${asset._id}/content`;
  return asset.url?.startsWith("data:") ? asset.url : await signedImageUrl(asset.key);
}
export async function uploadEditorAudio(userId: string, projectId: string, bytes: Buffer, name: string, contentType: string, role: string, licenseConfirmed: boolean) {
  if (!persistentStorageConfigured()) editorFail("Configure private R2 storage before uploading audio", 503);
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) editorFail("Audio must be between 1 byte and 100 MB");
  const dir = await mkdtemp(path.join(tmpdir(), "drex-audio-"));
  try {
    const file = path.join(dir, "source"); await writeFile(file, bytes);
    const probe = await probeMedia(file).catch(() => editorFail("This audio file could not be read. Upload MP3, WAV, FLAC, Ogg or M4A audio."));
    if (!probe.audio || probe.video || !probe.duration || probe.duration > 3600) editorFail("Upload readable audio up to one hour, without a video track");
    if (role === "music" && !licenseConfirmed) editorFail("Confirm that you have permission to use this music");
    const stored = await uploadAudio(bytes, `${userId}/editor-audio/${randomUUID()}`, contentType);
    return await MediaAsset.create({ userId, projectId, provider: "upload", type: "audio", ...stored, contentType, sizeBytes: bytes.length, durationSeconds: probe.duration, metadata: { name: name.slice(0, 150), audioRole: role, licenseConfirmed, originalUpload: true } });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export function editingSuggestions(timeline: EditorTimeline) {
  const suggestions: any[] = [];
  timeline.clips.forEach(c => {
    if (!c.nativeDialogue && c.sourceAudio !== true && c.duration > 10 && !timeline.audio.some(a => a.anchorClipId === c.id)) suggestions.push({ id: `pace-${c.id}`, clipId: c.id, label: `Shorten “${c.label}” from ${c.duration.toFixed(1)}s to 6s`, reason: "This long shot has no anchored speech. Review for tighter pacing.", patch: { duration: 6 } });
    if (c.transition === "cut") suggestions.push({ id: `fade-${c.id}`, clipId: c.id, label: `Fade through black for “${c.label}”`, reason: "A short fade can separate scene boundaries without moving audio.", patch: { transition: "fade" } });
  });
  return suggestions.slice(0, 20);
}
export function captionsFromTranscript(timeline: EditorTimeline, assets: any[]) {
  const style = { font: "Arial" as const, size: 36, position: "bottom" as const, preset: "clean" as const };
  const narration = timeline.audio.filter(a => ["narration", "dialogue"].includes(a.role)).flatMap(a => {
    const asset = assets.find(asset => String(asset._id) === a.assetId);
    const text = String(asset?.metadata?.transcript || asset?.prompt || "").trim();
    if (!text) return [];
    const words = text.split(/\s+/), groups = [];
    for (let i = 0; i < words.length; i += 8) groups.push(words.slice(i, i + 8).join(" "));
    // Saved transcripts have no word timestamps: evenly distribute phrases over measured speech.
    const full = asset?.durationSeconds || a.duration;
    return groups.flatMap((text, i) => {
      const sourceStart = i / groups.length * full, sourceEnd = (i + 1) / groups.length * full;
      const start = Math.max(sourceStart, a.sourceIn), end = Math.min(sourceEnd, a.sourceIn + a.duration);
      return end > start ? [{ id: randomUUID(), text, start: a.start + start - a.sourceIn, end: a.start + end - a.sourceIn, anchorClipId: a.anchorClipId, verification: "transcript" as const, style }] : [];
    });
  });
  const native = timeline.clips.filter(c => c.kind === "video" && c.sourceAudio === true).flatMap(c => {
    const asset = assets.find(a => String(a._id) === c.assetId);
    const transcript = asset?.metadata?.verifiedTranscript;
    if (!transcript?.text) return [];
    // Only reviewed actual audio transcripts become native-dialogue captions.
    const start = 0, end = c.duration;
    return [{ id: randomUUID(), text: String(transcript.text).slice(0, 500), start, end, anchorClipId: c.id, verification: "transcript" as const, style }];
  });
  return [...narration, ...native];
}
