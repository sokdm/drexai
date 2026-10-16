import { test } from "node:test";
import assert from "node:assert/strict";
import { speechRanges, retainTimelineRanges } from "../dist/services/silenceEditing.js";
import { editingCommand } from "../dist/services/editorCommands.js";
import { timelineSchema, effectValues } from "@drex/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMedia, renderTimeline } from "../dist/services/ffmpeg.js";
import { parseTranscript } from "../dist/services/transcription.js";
const timeline = { clips: [{ id: "v", assetId: "a".repeat(24), kind: "video", label: "Speech", sourceIn: 2, duration: 10 }], audio: [{ id: "a", assetId: "b".repeat(24), label: "Voice", role: "dialogue", start: 0, sourceIn: 1, duration: 10 }], captions: [{ id: "c", text: "Speech", start: 6, end: 8 }], aspectRatio: "16:9", musicDecision: "none" };
test("silence removal moves visuals, audio and captions through identical intervals", () => {
 const ranges = speechRanges("silence_start: 2\nsilence_end: 5", 10, 0);
 assert.deepEqual(ranges, [[0, 2], [5, 10]]);
 const cut = retainTimelineRanges(timeline, ranges);
 assert.equal(cut.clips[1].sourceIn, 7); assert.equal(cut.clips[1].duration, 5);
 assert.equal(cut.audio[1].start, 2); assert.equal(cut.audio[1].sourceIn, 6);
 assert.equal(cut.captions[0].start, 3); assert.equal(cut.captions[0].end, 5);
 assert.equal(timeline.clips.length, 1);
 assert.throws(() => retainTimelineRanges(timeline, []), /entire selection/);
 assert.deepEqual(speechRanges("silence_start: 0\nsilence_end: 10", 10, 0), []);
});
test("color commands produce bounded persisted renderer values", () => {
 const result = editingCommand(timeline, "Make this cinematic with vignette and sharpen").timeline;
 assert.equal(result.clips[0].look, "cinematic"); assert.equal(result.clips[0].vignette, true);
 assert.equal(effectValues(result.clips[0]).contrast, 1.15);
 assert.equal(editingCommand(result, "reset effects").timeline.clips[0].sharpen, 0);
});
test("chunk transcription offsets are preserved and invalid timestamps fail", () => {
 assert.deepEqual(parseTranscript({ text: "Hello", segments: [{ start: 1, end: 2, text: "Hello" }] }, 60, 120), [{ start: 121, end: 122, text: "Hello" }]);
 assert.throws(() => parseTranscript({ text: "Hello", segments: [] }, 60), /timestamps/);
 assert.throws(() => parseTranscript({ text: "Hello", segments: [{ start: 0, end: 70, text: "Hello" }] }, 60), /out-of-range/);
});
test("real FFmpeg exports effects and detects silence in the mixed audiovisual output", { timeout: 90000 }, async () => {
 const directory = await mkdtemp(path.join(tmpdir(), "drex-silence-effects-test-"));
 try {
  const file = path.join(directory, "source.mp4");
  await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-af", "volume=enable='between(t,1,3)':volume=0", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", file]);
  const t = timelineSchema.parse({ ...timeline, clips: [{ ...timeline.clips[0], sourceIn: 0, duration: 4, sourceAudio: true, look: "cinematic", sharpen: .5, vignette: true }], audio: [], captions: [] });
  const rendered = await renderTimeline(t, { resolution: "480p", quality: "draft", filename: "test", format: "mp4" }, new Map([["a".repeat(24), file]]), directory);
  assert.ok(Math.abs(rendered.duration - 4) < .15);
  const log = await runMedia("ffmpeg", ["-i", rendered.file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-"], { includeStderr: true });
  const ranges = speechRanges(log, 4); assert.equal(ranges.length, 2);
  const cut = retainTimelineRanges(t, ranges); assert.ok(cut.clips.reduce((n, c) => n + c.duration, 0) < 3);
 } finally { await rm(directory, { recursive: true, force: true }); }
});
