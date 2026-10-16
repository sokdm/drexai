import { test } from "node:test";
import assert from "node:assert/strict";
import { editingCommand } from "../dist/services/editorCommands.js";
const timeline = { clips: [{ id: "first", kind: "title", label: "One", text: "Original", sourceIn: 0, duration: 20 }, { id: "second", kind: "title", label: "Two", sourceIn: 0, duration: 20 }], audio: [], captions: [{ id: "caption", text: "Actual reviewed speech", start: 1, end: 3, style: { font: "Arial", size: 36, position: "bottom", preset: "clean" } }], aspectRatio: "16:9", musicDecision: "none" };
test("supported editor commands change valid real timeline data without mutating the original", () => {
 assert.equal(editingCommand(timeline, "Add transitions").timeline.clips[0].transition, "fade");
 const short = editingCommand(timeline, "Make a 30-second short").timeline; assert.equal(short.aspectRatio, "9:16"); assert.equal(short.clips[1].duration, 10);
 assert.equal(editingCommand(timeline, "Add animated captions").timeline.captions[0].style.animation, "pop");
 const intro = editingCommand(timeline, 'Create an intro "New story"').timeline; assert.equal(intro.clips[0].text, "New story"); assert.equal(intro.captions[0].start, 4);
 assert.equal(timeline.clips.length, 2); assert.equal(timeline.clips[1].duration, 20);
});
test("unsupported silence and effects requests fail honestly", () => { assert.throws(() => editingCommand(timeline, "Remove silent parts"), /does not yet support/); assert.throws(() => editingCommand({ ...timeline, captions: [] }, "Generate captions"), /No reviewed transcript/); });
