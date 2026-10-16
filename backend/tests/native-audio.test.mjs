import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildStudioSteps, studioSettingsSchema, makeTimeline } from "../dist/services/studioPlan.js";
import { sceneDialogue, segmentDialogue, needsNarration, buildVeoPrompt } from "../dist/services/sceneAudio.js";
import { veoRequest, validateVideoSettings } from "../dist/services/videoGeneration.js";
import { inspectNativeVideo } from "../dist/services/nativeAudio.js";
import { runMedia, probeMedia, renderTimeline } from "../dist/services/ffmpeg.js";
import { timelineSchema, splitTimeline } from "@drex/shared";
import { roughCut, captionsFromTranscript, editingSuggestions } from "../dist/services/videoEditing.js";

const id = n => String(n).padStart(24, "0");
const scene = (extra = {}) => ({ _id: id(1), order: 1, title: "Conversation", imagePrompt: "Two adult friends outside a house", videoMotionPrompt: "Medium close-up", approved: true, characters: ["Daniel", "Ada"], narration: "Do not duplicate this speech", dialogue: 'Daniel: Where have you been?\nAda: I was at the market.', ...extra });
const snapshot = scenes => ({ title: "Native audio test", scenes, characters: [{ name: "Daniel", appearance: "Green jacket" }, { name: "Ada", appearance: "Blue shirt" }] });

test("A/B/C: speaker order, accents and environmental cues reach the official SDK request", () => {
  const lines = sceneDialogue(scene());
  const request = veoRequest({ model: "veo-3.1-generate-preview", motionPrompt: "Outside a Nigerian house", dialogueLines: lines, preferredAccent: "Nigerian English", environmentalSounds: "Distant birds and traffic", durationSeconds: 8, quantity: 1, quality: "720p", aspectRatio: "16:9", sourceImageBytes: "aW1hZ2U=", sourceImageMimeType: "image/jpeg" });
  assert.match(request.prompt, /Daniel says "Where have you been\?"/); assert.match(request.prompt, /Ada says "I was at the market\."/);
  assert.ok(request.prompt.indexOf("Daniel says") < request.prompt.indexOf("Ada says")); assert.match(request.prompt, /Nigerian English/); assert.match(request.prompt, /Distant birds/);
  assert.deepEqual(request.image, { imageBytes: "aW1hZ2U=", mimeType: "image/jpeg" }); assert.equal(request.config.numberOfVideos, 1);
  assert.equal(request.config.generateAudio, undefined); assert.equal(request.config.voiceId, undefined);
  assert.match(buildVeoPrompt({ motionPrompt: "Wind in trees" }), /No spoken dialogue/);
  assert.equal(needsNarration(scene()), false);
});
test("D/F: native dialogue does not create billable TTS; requested off-screen narration does", () => {
  const settings = studioSettingsSchema.parse({ maxClipsPerScene: 3 });
  let steps = buildStudioSteps(snapshot([scene()]), settings);
  assert.equal(steps.filter(s => s.kind === "audio").length, 0); assert.equal(steps.filter(s => s.kind === "video").length, 1);
  assert.match(steps.find(s => s.kind === "video").input.characterDescriptions, /Green jacket/);
  steps = buildStudioSteps(snapshot([scene({ offscreenNarration: true })]), settings);
  assert.equal(steps.filter(s => s.kind === "audio").length, 1); assert.equal(steps.find(s => s.kind === "audio").input.track, "narration");
  const long = scene({ dialogue: "Daniel: " + Array(40).fill("hello").join(" ") });
  const groups = segmentDialogue(sceneDialogue(long)); assert.equal(groups.length, 3);
  assert.equal(groups.flat().map(l => l.text).join(" "), Array(40).fill("hello").join(" "));
  assert.throws(() => buildStudioSteps(snapshot([long]), studioSettingsSchema.parse({ maxClipsPerScene: 1 })), /needs 3 dialogue clips/);
  assert.throws(() => sceneDialogue(scene({ dialogue: "Who is speaking?" })), /identify each speaker/);
});
test("supported duration/resolution combinations and output count are validated", () => {
  const input = { model: "veo-3.1-generate-preview", sourceImageAssetId: id(1), motionPrompt: "A tree sways", durationSeconds: 4, quality: "720p", aspectRatio: "16:9", quantity: 1 };
  assert.equal(validateVideoSettings(input).nativeAudio, true);
  assert.throws(() => validateVideoSettings({ ...input, quality: "1080p" }), /eight-second/);
  assert.throws(() => validateVideoSettings({ ...input, quantity: 2 }), /1-1/);
  assert.throws(() => validateVideoSettings({ ...input, model: "unsupported" }), /Unsupported Veo/);
});
test("native clips remain whole, source sound persists through splitting, and intended script is not a transcript", () => {
  const settings = studioSettingsSchema.parse({ targetSeconds: 4 }); const source = snapshot([scene()]);
  const steps = buildStudioSteps(source, settings).map((s, i) => ({ ...s, assetId: id(i + 20), status: "completed" }));
  const assets = steps.map(s => ({ _id: s.assetId, durationSeconds: 8, metadata: { nativeAudio: true, intendedDialogue: s.input.dialogueLines } }));
  const timeline = makeTimeline(source, settings, steps, assets); assert.equal(timeline[0].durationSeconds, 8); assert.equal(timeline[0].clips[0].durationSeconds, 8);
  const edit = roughCut({ timeline, settings }); assert.equal(edit.clips[0].sourceAudio, true);
  const split = splitTimeline(edit, edit.clips[0].id, 3, "split"); assert.equal(split.clips[1].sourceIn, 3); assert.equal(split.clips[1].sourceAudio, true);
  assert.equal(captionsFromTranscript(edit, assets).length, 0);
  assets.find(a => a._id === edit.clips[0].assetId).metadata.verifiedTranscript = { text: "Actual reviewed words" };
  assert.equal(captionsFromTranscript(edit, assets)[0].text, "Actual reviewed words");
  assert.ok(!editingSuggestions(edit).some(s => s.id.startsWith("pace-")));
});
test("E/G: FFmpeg preserves native sound timing while mixing narration/music and rejects missing or silent audio", { timeout: 120000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "drex-native-test-"));
  try {
    const source = path.join(dir, "native.mp4"), silent = path.join(dir, "silent.mp4"), noAudio = path.join(dir, "no-audio.mp4"), voice = path.join(dir, "voice.wav");
    await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=854x480:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
    await runMedia("ffmpeg", ["-y", "-i", source, "-an", "-c:v", "copy", noAudio]);
    await runMedia("ffmpeg", ["-y", "-i", source, "-af", "volume=0", "-c:v", "copy", silent]);
    await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", voice]);
    assert.equal((await inspectNativeVideo(await readFile(source))).audioReview.lipSync, "requires_human_review");
    await assert.rejects(async () => inspectNativeVideo(await readFile(noAudio)), /native audio tracks/);
    await assert.rejects(async () => inspectNativeVideo(await readFile(silent)), /silent/);
    const t = timelineSchema.parse({ clips: [{ id: "intro", kind: "title", label: "Intro", duration: 0.5 }, { id: "native", kind: "video", label: "Native dialogue", assetId: id(2), duration: 1.5, sourceIn: 0.5, sourceAudio: true, nativeDialogue: true }, { id: "second", kind: "video", label: "Next scene", assetId: id(2), duration: 1, sourceIn: 0, sourceAudio: true }], audio: [{ id: "narrator", assetId: id(3), label: "Offscreen", role: "narration", start: 1, duration: 1, volume: 0.2 }], captions: [{ id: "caption", text: "Reviewed words", start: 0.5, end: 1.5 }], aspectRatio: "16:9", musicDecision: "none" });
    const rendered = await renderTimeline(t, { format: "mp4", resolution: "480p", quality: "draft", filename: "native-mix" }, new Map([[id(2), source], [id(3), voice]]), dir);
    assert.ok(Math.abs(rendered.duration - 3) < 0.15); assert.ok((await probeMedia(rendered.file)).audio);
    const decoded = path.join(dir, "audio.f32"); await runMedia("ffmpeg", ["-y", "-i", rendered.file, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", decoded]);
    const bytes = await readFile(decoded);
    function amplitude(start, frequency) { let real = 0, imaginary = 0; for (let i = 0; i < 4800; i++) { const value = bytes.readFloatLE((Math.round(start * 48000) + i) * 4), angle = 2 * Math.PI * frequency * i / 48000; real += value * Math.cos(angle); imaginary += value * Math.sin(angle); } return Math.hypot(real, imaginary) / 4800; }
    assert.ok(amplitude(0.8, 700) > 0.02); assert.ok(amplitude(2.3, 700) > 0.02); assert.ok(amplitude(0.2, 700) < 0.001); assert.ok(amplitude(1.3, 440) > 0.005);
    await mkdir(path.join(dir, "muted")); t.clips.forEach(c => { c.sourceMuted = true; });
    const muted = await renderTimeline(t, { format: "mp4", resolution: "480p", quality: "draft", filename: "muted" }, new Map([[id(2), source], [id(3), voice]]), path.join(dir, "muted")); assert.ok(muted.audio);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
