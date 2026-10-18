import {timelineSchema} from "@drex/shared";
import {editingCommand} from "./editorCommands.js";
import {validateTimelineAssets,editorAssetBytes,editorFail,captionsFromTranscript} from "./videoEditing.js";
import {withProvider,checkGenerationUser} from "./platformControl.js";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {renderTimeline,runMedia} from "./ffmpeg.js";
import {speechRanges,retainTimelineRanges} from "./silenceEditing.js";
export async function executeTimelineTool(userId:string,message:string,raw:unknown){
 const input={message,timeline:timelineSchema.parse(raw)};
 const assets = await validateTimelineAssets(input.timeline, userId);
 const result = /silent|silence/i.test(input.message) ? await withProvider("ffmpeg", async () => {
   await checkGenerationUser(userId);
   const total = input.timeline.clips.reduce((n, c) => n + c.duration, 0);
   if (!total || total > 300) editorFail("Silence analysis currently supports edits up to five minutes. Split longer edits first.");
   const directory = await mkdtemp(path.join(tmpdir(), "drex-silence-"));
   try {
     const sources = new Map<string, string>();
     let sourceBytes = 0;
     for (const asset of assets) {
       if ((asset.sizeBytes || 0) > 250 * 1024 * 1024) editorFail("Source exceeds the silence analysis size limit");
       const bytes = await editorAssetBytes(asset); sourceBytes += bytes.length;
       if (bytes.length > 250 * 1024 * 1024 || sourceBytes > 500 * 1024 * 1024) editorFail("Sources exceed the silence analysis size limit");
       const file = path.join(directory, String(asset._id)); await writeFile(file, bytes); sources.set(String(asset._id), file);
     }
     const rendered = await renderTimeline(input.timeline, { format: "mp4", resolution: "480p", quality: "draft", filename: "silence-analysis" }, sources, directory);
     const log = await runMedia("ffmpeg", ["-hide_banner", "-nostdin", "-i", rendered.file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-"], { includeStderr: true, stderrLimit: 2 * 1024 * 1024 });
     const ranges = speechRanges(log, total), timeline = retainTimelineRanges(input.timeline, ranges);
     return { timeline, explanation: `Removed ${(total - timeline.clips.reduce((n, c) => n + c.duration, 0)).toFixed(2)} seconds below -35 dB lasting at least 0.6 seconds, preserving 0.12-second handles. All audio and captions were cut with the video. Music can mask silence; review and undo if needed.` };
   } finally { await rm(directory, { recursive: true, force: true }); }
 }) : editingCommand(input.timeline, input.message, captionsFromTranscript(input.timeline, assets));
 await validateTimelineAssets(result.timeline, userId);
 return result;
}
