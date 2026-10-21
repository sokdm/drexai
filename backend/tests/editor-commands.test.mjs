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

test('natural join wording and movie outros execute real supported timeline changes',()=>{for(const request of ['the clips joing are too far add better animations','Make the cuts seamless','Crossfade these clips']){const result=editingCommand(timeline,request);assert.equal(result.timeline.clips[0].transition,'dissolve');assert.equal(result.timeline.clips.reduce((n,c)=>n+c.duration,0),40);}const outro=editingCommand(timeline,'Add a to be continued outro').timeline;assert.equal(outro.clips.at(-1).kind,'title');assert.match(outro.clips.at(-1).text,/To be continued/);});

test('natural-language planner is restricted to supported tools and rejects invented actions',async()=>{const {resolveEditingRequest}=await import('../dist/services/editorToolExecution.js');assert.equal(await resolveEditingRequest('fixture','Make these cuts less jarring',async()=>JSON.stringify({action:'dissolve'})),'smooth joins');await assert.rejects(()=>resolveEditingRequest('fixture','Publish everywhere',async()=>JSON.stringify({action:'none'})),/not supported/);await assert.rejects(()=>resolveEditingRequest('fixture','Delete all',async()=>JSON.stringify({action:'delete_everything'})));});
