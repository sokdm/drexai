import mongoose from 'mongoose';
import {StudioProduction} from '../models/StudioProduction.js';
import {CreditApproval} from '../models/CreditApproval.js';
import {CreditReservation} from '../models/CreditReservation.js';
import {MediaAsset} from '../models/MediaAsset.js';
import {buildStudioSteps,studioSettingsSchema} from './studioPlan.js';
import {priceStudioSteps} from './studioPricing.js';
import {configuredModels} from './platformControl.js';
import {imageModels} from './imageGeneration.js';
import {videoModels} from './videoGeneration.js';
import {ttsModels} from './textToSpeech.js';
const fail=(message:string):never=>{throw Object.assign(new Error(message),{code:'APPROVAL_STATE',statusCode:409})};
async function own(userId:string,id:string){const p=await StudioProduction.findOne({_id:id,userId});if(!p)fail('Production not found');return p!;}
function idle(p:any){if(!['draft','paused','failed'].includes(p.status)||p.control==='cancel'||p.leaseUntil>new Date())fail('Pause the production and wait for the current operation before changing models.');if(p.steps.some((s:any)=>s.status!=='completed'&&s.status!=='skipped'&&(s.providerJobId||s.status==='running'||s.status==='processing')))fail('A provider request is already submitted. Resume its saved job before changing models.');}
async function build(p:any,kind:string,model:string,quality?:string){
 const key=kind==='image'?'imageModel':kind==='audio'?'voiceModel':'videoModel';
 const settings=studioSettingsSchema.parse({...p.settings,[key]:model,agentSelectModels:false,...(kind==='video'&&quality?{quality}:{}),...(kind==='image'&&quality?{resolution:quality}:{})});
 if(kind==='audio'){const m=ttsModels.find(m=>m.id===model);if(!m)throw new Error('Unsupported speech model');if(!m.voices.includes(settings.voiceId))settings.voiceId=m.voices[0];settings.characterVoices={};}
 const snapshot=JSON.parse(JSON.stringify(p.snapshot));
 // Real measured narration takes priority when rebuilding only unsubmitted video clips.
 if(kind==='video'){const assets=await MediaAsset.find({_id:{$in:p.steps.filter((s:any)=>s.kind==='audio'&&s.status==='completed').map((s:any)=>s.assetId)},userId:p.userId}).lean();for(const scene of snapshot.scenes){const seconds=assets.filter(a=>String(a.sceneId)===String(scene._id)).reduce((n,a)=>n+Number(a.durationSeconds||0),0);if(seconds>0)scene.estimatedDurationSeconds=seconds;}}
 if(kind==='video'&&p.steps.some((s:any)=>s.kind==='video'&&s.status==='completed'))fail('Some video clips are already completed. Finish this operation before changing its model to avoid repeating footage.');
 const generated=buildStudioSteps(snapshot,{...settings,narration:kind==='audio'&&settings.narration,video:kind==='video'&&settings.video}).filter(s=>s.kind===kind);
 const fixed=p.steps.filter((s:any)=>s.kind!==kind||['completed','skipped'].includes(s.status));
 const remaining=generated.filter(s=>!fixed.some((old:any)=>old.key===s.key));
 const estimate=await priceStudioSteps(remaining);if(estimate.credits==null||estimate.missingPricing.length)fail('This model/quality has no verified price for the requested operation. Choose another supported option.');
 return {settings,steps:[...fixed,...remaining].sort((a:any,b:any)=>({image:0,audio:1,video:2} as any)[a.kind]-({image:0,audio:1,video:2} as any)[b.kind]||a.sceneOrder-b.sceneOrder||(a.input.clipIndex||0)-(b.input.clipIndex||0)),remaining,estimate};
}
export async function operationChoices(userId:string,id:string,kind:string){const p=await own(userId,id);idle(p);const models=await configuredModels(kind==='audio'?'voice':kind,kind==='image'?imageModels:kind==='audio'?ttsModels:videoModels as any);const options:any[]=[];
 for(const m of models as any[])for(const quality of kind==='video'?m.qualities:kind==='image'?m.resolutions:[undefined])try{const next=await build(p,kind,m.id,quality);if(next.remaining.length)options.push({model:m.id,label:m.label,quality,credits:next.estimate.credits,quantity:next.remaining.length,seconds:next.estimate.maxVideoSeconds});}catch{}
 return {options:options.sort((a,b)=>a.credits-b.credits)};
}
export async function requoteOperation(userId:string,id:string,kind:string,model:string,quality?:string){
 const p=await own(userId,id);idle(p);const choices=await operationChoices(userId,id,kind);if(!choices.options.some(o=>o.model===model&&o.quality===quality))fail('This model/quality is no longer available. Refresh supported options.');
 const next=await build(p,kind,model,quality);const session=await mongoose.startSession();try{await session.withTransaction(async()=>{
 const current=await StudioProduction.findOne({_id:id,userId,updatedAt:p.updatedAt}).session(session);if(!current)fail('The production changed. Refresh before changing models.');idle(current);
 if(current!.reservationId&&await CreditReservation.exists({userId,_id:current!.reservationId,status:'reserved'}).session(session))fail('The current operation still has reserved credits. Finish or cancel it before changing models.');
 current!.snapshot={...current!.snapshot,operationQuoteRevision:new mongoose.Types.ObjectId().toString()};current!.markModified('snapshot');
 current!.settings=next.settings;current!.steps=next.steps;current!.estimate={...current!.estimate,credits:next.steps.filter((s:any)=>!['completed','skipped'].includes(s.status)).reduce((n:number,s:any)=>n+s.credits,0),missingPricing:[],maxVideoSeconds:next.steps.filter((s:any)=>s.kind==='video').reduce((n:number,s:any)=>n+s.input.durationSeconds,0)};current!.status='paused';current!.control='pause';current!.approvalMode='cards';current!.expiresAt=new Date(Date.now()+600000);current!.markModified('steps');await current!.save({session});await CreditApproval.updateMany({productionId:id,userId,status:'pending'},{$set:{status:'superseded'}},{session});
 });}finally{await session.endSession();}return {production:await StudioProduction.findById(id)};
}
