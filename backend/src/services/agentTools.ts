import { StudioProduction, StudioEvent } from "../models/StudioProduction.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { VideoEdit } from "../models/VideoEdit.js";
import { ensureProductionEdit, applyProductionEdit } from "./sharedEditing.js";
import { prepareProduction, controlProduction } from "./productionTools.js";
import { z } from "zod";
const id=z.string().regex(/^[a-f\d]{24}$/i);
export const productionToolNames=["inspect_production","list_assets","list_asset_packs","apply_asset_pack","edit_timeline","prepare_production","production_exports","control_production","regenerate_output"] as const;
export async function executeProductionTool(tool:{name:string;query:string},context:{userId:string;productionId?:string;projectId?:string;settings?:any;allowTimelineEdits:boolean}){
 if(!(productionToolNames as readonly string[]).includes(tool.name))throw new Error("Unsupported production tool");
 const {userId,allowTimelineEdits}=context;
 if(tool.name==="prepare_production"){
  if(!context.projectId||!context.settings)throw new Error("Choose an approved project and production settings before planning.");
  const production=await prepareProduction(userId,{projectId:context.projectId,settings:context.settings});
  return {productionPlan:production,requiresBudgetApproval:true,message:"Plan prepared; no generation submitted. Approve the frozen budget to execute."};
 }
 if(tool.name==="control_production"){
  if(!context.productionId)throw new Error("Select a production first");
  if(!allowTimelineEdits)throw new Error("Explicit production control permission is required");
  const action=z.enum(["pause","resume","cancel","retry"]).parse(tool.query.trim());
  const production=await controlProduction(userId,context.productionId,{action});
  return {id:production?._id,status:production?.status,control:production?.control};
 }
 const production=context.productionId?await StudioProduction.findOne({_id:id.parse(context.productionId),userId}):null;
 let result:any;
 if(tool.name==="regenerate_output"){
  if(!production || !allowTimelineEdits)throw new Error("Choose an owned production and explicitly request regeneration");
  if(!production.steps.some((s:any)=>s.key===tool.query))throw new Error("Choose an existing output step key from production status");
  const plan=await prepareProduction(userId,{projectId:String(production.projectId),settings:production.settings,sourceProductionId:String(production._id),regenerateStepKey:tool.query});
  return {productionPlan:plan,requiresBudgetApproval:true,message:"Replacement output quoted; completed independent assets are reused. New media is not submitted until budget approval."};
 }
 if(tool.name==="production_exports"){
  if(!production)throw new Error("Choose an owned production first");
  const {VideoExport}=await import("../models/VideoEdit.js");
  const edit=await VideoEdit.findOne({productionId:production._id,userId});
  return edit?await VideoExport.find({editId:edit._id,userId}).select("status progress error revision completedAt").sort({createdAt:-1}).limit(5).lean():[];
 }

     if (!production) throw new Error("Choose an owned Studio production before using production tools");
     await StudioEvent.create({ productionId: production._id, userId: userId, level: "processing", message: "AI Director tool: " + tool.name });
     if (tool.name === "inspect_production") result = { id: production._id, status: production.status, steps: production.steps.map((s: any) => ({ key:s.key,label: s.label, status: s.status, error: s.error,credits:s.credits })) };
     else if (tool.name === "list_assets") result = await MediaAsset.find({ userId: userId, productionId: production._id, deletedAt: null }).select("type sceneId durationSeconds metadata.name").lean();
     else if (tool.name === "list_asset_packs") { const { AssetPack } = await import("../routes/assetPacks.js"); result = await AssetPack.find({ active:true }).select("name kind license").limit(50).lean(); }
     else {
      if (!allowTimelineEdits) throw new Error("Enable timeline editing permission before asking the agent to change this production");
      if (!production.timeline?.length && !(production.snapshot as any)?.manual) throw new Error("Production has no editable rough cut yet");
      const edit = await ensureProductionEdit(production);
      if (tool.name === "apply_asset_pack") {
       const { AssetPack, applyPackPreset } = await import("../routes/assetPacks.js");
       const pack = await AssetPack.findOne({ _id:id.parse(tool.query.trim()),active:true });
       if (!pack || ["music","brand"].includes(pack.kind!)) throw new Error("Select an available editing preset. Import media packs through the asset library.");
       const timeline = applyPackPreset(edit.timeline,pack.preset);
       const saved = await VideoEdit.findOneAndUpdate({ _id:edit._id,userId:userId,revision:edit.revision },{ $set:{timeline},$inc:{revision:1} },{new:true});
       if (!saved) throw new Error("Timeline changed. Refresh and retry");
       result = { editId:saved._id,revision:saved.revision,explanation:"Applied licensed preset " + pack.name + ". Timeline editing was free." };
      } else {
       const applied = await applyProductionEdit(production, tool.query, edit.revision);
       result = { editId: applied.edit._id, revision: applied.edit.revision, explanation: applied.explanation };
      }
     }
     await StudioEvent.create({ productionId: production._id, userId: userId, level: "success", message: "AI Director completed: " + tool.name });
 return result;
}
