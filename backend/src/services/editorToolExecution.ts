import {z} from 'zod';
import {freeChatTerms} from './chatAccess.js';
import {routerText} from './openrouter.js';
const editIntentSchema=z.object({action:z.enum(['dissolve','professional','cinematic','warm','cool','monochrome','vivid','zoom','pan_left','pan_right','captions','none'])});
export async function resolveEditingRequest(userId:string,message:string,request?: (options:any)=>Promise<string>){
 const terms=request?null:await freeChatTerms(userId,1);
 const raw=await (request||routerText)({model:terms?.model,requestLimits:terms?.requestLimits,userId,maxOutputTokens:150,schema:editIntentSchema,system:'Translate only the explicit latest editing request into one supported editing action. dissolve blends scene cuts; professional applies cinematic color and transitions; zoom and pan animate framing; captions styles existing reviewed captions. Choose none for unsupported requests, generation, publishing, deletion, transcription, or ambiguous instructions. Never claim a tool ran. Return JSON only.',prompt:message.slice(0,1000)});
 const {action}=editIntentSchema.parse(JSON.parse(raw));const commands:Record<string,string>={dissolve:'smooth joins',professional:'professional',cinematic:'cinematic',warm:'warm',cool:'cool',monochrome:'monochrome',vivid:'vivid',zoom:'slow zoom',pan_left:'pan left',pan_right:'pan right',captions:'animate captions'};
 if(!commands[action])throw new Error('That edit is not supported yet. Choose smooth joins, color, motion, captions, an intro/outro, or silence analysis. No changes were made.');return commands[action];
}
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
 }) : await (async()=>{try{return editingCommand(input.timeline,input.message,captionsFromTranscript(input.timeline,assets));}catch(error){if(!(error instanceof Error)||!error.message.startsWith('Supported commands:'))throw error;const command=await resolveEditingRequest(userId,input.message);return editingCommand(input.timeline,command,captionsFromTranscript(input.timeline,assets));}})();
 await validateTimelineAssets(result.timeline, userId);
 return result;
}
