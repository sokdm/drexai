import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {MediaAsset} from '../models/MediaAsset.js';
import {StudioProduction} from '../models/StudioProduction.js';
import {VideoEdit} from '../models/VideoEdit.js';
import {editorAssetBytes,validateTimelineAssets} from './videoEditing.js';
import {probeMedia} from './ffmpeg.js';import {inspectNativeVideo} from './nativeAudio.js';
export async function inspectProductionQuality(userId:string,productionId:string){
 const production=await StudioProduction.findOne({_id:productionId,userId});if(!production)throw new Error('Production not found');
 const assets=await MediaAsset.find({userId,_id:{$in:production.steps.filter((s:any)=>s.status==='completed').map((s:any)=>s.assetId)},deletedAt:null}).lean();
 const findings:any[]=[];const directory=await mkdtemp(path.join(tmpdir(),'drex-quality-'));
 try{for(const step of production.steps.filter((s:any)=>s.status==='completed')){const asset=assets.find(a=>String(a._id)===String(step.assetId));if(!asset){findings.push({stepKey:step.key,status:'failed',issue:'Completed output is missing from the asset library',repair:'Restore the asset or request regenerate_output with fresh credit approval'});continue;}
 if(step.kind!=='video')continue;try{const bytes=await editorAssetBytes(asset);const file=path.join(directory,String(asset._id)+'.mp4');await writeFile(file,bytes);const probe=await probeMedia(file);if(!probe.video||!probe.audio||probe.duration<=0)throw new Error('Readable video and native audio tracks are required');if(step.input.nativeDialogue)await inspectNativeVideo(bytes);const durationMismatch=Math.abs(probe.duration-Number(step.input.durationSeconds))>.6;findings.push({stepKey:step.key,status:durationMismatch?'needs_review':'passed',durationSeconds:probe.duration,issue:durationMismatch?'Output duration differs from the approved clip duration':undefined,dialogueVerification:step.input.nativeDialogue?'Human review required for wording, speakers and lip synchronization':'No dialogue requested',repair:durationMismatch?'Review the actual clip in the existing editor; regenerate only after a fresh quote':undefined});}catch(e:any){findings.push({stepKey:step.key,status:'failed',issue:e.message,repair:'Use regenerate_output for this step, review its quote and approve before regeneration',repairTool:{name:'regenerate_output',query:step.key,requiresCreditApproval:true}});}}
 const edit=await VideoEdit.findOne({userId,productionId});if(edit){try{await validateTimelineAssets(edit.timeline,userId);findings.push({tool:'shared_editor',status:'passed',revision:edit.revision});}catch(e:any){findings.push({tool:'shared_editor',status:'failed',issue:e.message});}}
 const unfinishedOutputs=production.steps.filter((s:any)=>!['completed','skipped'].includes(s.status)).length;
 const report={checkedAt:new Date(),unfinishedOutputs,findings,status:findings.some(f=>f.status==='failed')?'failed':findings.some(f=>f.status==='needs_review')?'needs_review':unfinishedOutputs?'incomplete_production':findings.length?'technical_checks_passed':'no_completed_outputs',semanticDialogue:'Not verified; review generated dialogue and lip sync before publishing',billableAi:false};
 await StudioProduction.updateOne({_id:productionId,userId},{$set:{qualityReport:report}});return report;
 }finally{await rm(directory,{recursive:true,force:true});}
}
