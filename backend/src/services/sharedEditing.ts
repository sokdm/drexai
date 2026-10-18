import {executeTimelineTool} from "./editorToolExecution.js";
import { VideoEdit } from "../models/VideoEdit.js";
import { AIProject } from "../models/AIProject.js";
import { roughCut, validateTimelineAssets, captionsFromTranscript } from "./videoEditing.js";
import { editingCommand } from "./editorCommands.js";
import { StudioEvent } from "../models/StudioProduction.js";

export async function ensureProductionEdit(production: any) {
 const userId = String(production.userId);
 // Never replace a user's saved manual changes when a production is reopened/retried.
 let edit = await VideoEdit.findOne({ userId, productionId: production._id });
 if (!edit) {
  let timeline = roughCut(production);
  const assets = await validateTimelineAssets(timeline, userId);
  timeline.captions = captionsFromTranscript(timeline, assets);
  await validateTimelineAssets(timeline, userId);
  edit = await VideoEdit.findOneAndUpdate({ userId, productionId: production._id }, { $setOnInsert: { userId, productionId: production._id, projectId: production.projectId, title: production.title || "Untitled edit", timeline, revision: 0 } }, { upsert: true, new: true });
 }
 await AIProject.updateOne({ _id: production.projectId, userId }, { $set: { latestEditId: edit!._id } });
 return edit!;
}
export async function applyProductionEdit(production: any, message: string, revision: number) {
 const edit = await ensureProductionEdit(production);
 if (edit.revision !== revision) throw Object.assign(new Error("The timeline changed in the manual editor. Refresh before applying this command."), { statusCode: 409 });
 const assets = await validateTimelineAssets(edit.timeline, String(production.userId));
 const proposal = await executeTimelineTool(String(production.userId), message, edit.timeline);
 await validateTimelineAssets(proposal.timeline, String(production.userId));
 const updated = await VideoEdit.findOneAndUpdate({ _id: edit._id, userId: production.userId, revision }, { $set: { timeline: proposal.timeline }, $inc: { revision: 1 } }, { new: true });
 if (!updated) throw Object.assign(new Error("Another editor changed this timeline. Refresh and retry."), { statusCode: 409 });
 await StudioEvent.create({ productionId: production._id, userId: production.userId, level: "success", message: `Editing command saved at revision ${updated.revision}: ${proposal.explanation}` });
 return { edit: updated, explanation: proposal.explanation };
}
