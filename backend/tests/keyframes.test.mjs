import { test } from "node:test";
import assert from "node:assert/strict";
import { timelineSchema, clipTransform, splitTimeline } from "@drex/shared";
import { renderTimeline, runMedia, subtitleDocument } from "../dist/services/ffmpeg.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { editingCommand } from "../dist/services/editorCommands.js";
const asset = "a".repeat(24);
const timeline = () => timelineSchema.parse({ clips: [{ id: "clip", kind: "video", label: "Motion", assetId: asset, duration: 2, sourceAudio: true, keyframes: [{ time: 0, zoom: 1, x: .5, y: .5 }, { time: 2, zoom: 2, x: .8, y: .2 }] }], audio: [], captions: [] });
test("bounded keyframes interpolate, persist and split without losing boundary motion", () => {
 const t = timeline(); assert.equal(clipTransform(t.clips[0], 1).zoom, 1.5);
 const split = timelineSchema.parse(splitTimeline(t, "clip", 1, "second"));
 assert.equal(split.clips[0].keyframes.at(-1).zoom, 1.5);
 assert.equal(split.clips[1].keyframes[0].zoom, 1.5);
 assert.equal(split.clips[1].keyframes.at(-1).time, 1);
 const invalid = timeline(); invalid.clips[0].keyframes[1].time = 3;
 assert.equal(timelineSchema.safeParse(invalid).success, false);
 assert.equal(editingCommand(t, "Add a slow zoom").timeline.clips[0].keyframes.at(-1).zoom, 1.2);
});
test("real FFmpeg exports animated crop with synchronized native audio", { timeout: 90000 }, async () => {
 const dir = await mkdtemp(path.join(tmpdir(), "drex-keyframes-"));
 try {
  const source = path.join(dir, "source.mp4");
  await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source]);
  const t = timeline();
  t.captions.push({ id: "overlay", text: "Original overlay", start: 0, end: 2, style: { font: "Arial", size: 36, position: "center", preset: "bold", color: "#ff8800", opacity: .8, rotation: 10, x: .4, y: .3 } });
  const ass = subtitleDocument(t, 854, 480);
  assert.ok(ass.includes("\\pos(342,144)")); assert.ok(ass.includes("\\1c&H0088ff&")); assert.ok(ass.includes("\\frz-10"));
  const out = await renderTimeline(t, { format: "mp4", resolution: "480p", quality: "draft", filename: "motion" }, new Map([[asset, source]]), dir);
  assert.equal(out.audio, true); assert.equal(out.width, 854); assert.ok(Math.abs(out.duration - 2) < .15);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
