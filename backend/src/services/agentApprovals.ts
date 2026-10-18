import mongoose from "mongoose";
import {createHash} from "node:crypto";
import {CreditApproval} from "../models/CreditApproval.js";
import {StudioEvent,StudioProduction} from "../models/StudioProduction.js";
import {AIProject} from "../models/AIProject.js";
import {AIConversation} from "../models/AIConversation.js";
import {CreditReservation} from "../models/CreditReservation.js";
import {Wallet} from "../models/Wallet.js";
import {reserveCredits} from "./wallet.js";
import {closeStudioReserve} from "./studioBilling.js";
import {studioLog} from "./studioExecution.js";
import {enqueueStudio,studioWorkerOnline} from "./studioQueue.js";
import {persistentStorageConfigured} from "./mediaStorage.js";
import {env} from "../config/env.js";
const fail=(message:string,statusCode=409):never=>{throw Object.assign(new Error(message),{statusCode});};
const unfinished=(p:any)=>p.steps.filter((s:any)=>!['completed','skipped'].includes(s.status));
export function approvalSignature(p:any,scope:string,steps:any[],credits:number){return createHash('sha256').update(JSON.stringify({scope,projectId:p.projectId,snapshot:p.snapshot,settings:p.settings,steps:steps.map(s=>({key:s.key,input:s.input,credits:s.credits})),credits})).digest('hex');}
export function publicApproval(a:any){return {_id:a._id,productionId:a.productionId,scope:a.scope,operation:a.operation,models:a.models,quantity:a.quantity,credits:a.credits,status:a.status,expiresAt:a.expiresAt,decidedAt:a.decidedAt,completedAt:a.completedAt};}
export async function ensureProductionApprovals(userId:string,productionId:string,conversationId?:string){
 const p=await StudioProduction.findOne({_id:productionId,userId});if(!p)fail('Production not found',404);
 if(conversationId&&!await AIConversation.exists({_id:conversationId,userId}))fail('Conversation not found',404);
 const active=p!.activeApprovalId?await CreditApproval.exists({_id:p!.activeApprovalId,userId,status:'approved'}):null;
 if(!active&&p!.control!=='cancel'&&['draft','paused'].includes(p!.status)&&(!p!.approvedAt||p!.approvalMode==='cards')&&!p!.leaseUntil){
  const remaining=unfinished(p),first=remaining[0];
  const groups:any[]=[{scope:'production',steps:remaining,operation:'Entire production budget',credits:remaining.reduce((n:number,s:any)=>n+s.credits,0)+(p!.settings.autoExport?Number(p!.estimate.renderCredits||0):0)}];
  if(first)groups.push({scope:'operation',steps:remaining.slice(0,remaining.findIndex((s:any)=>s.kind!==first.kind||s.input.model!==first.input.model)<0?remaining.length:remaining.findIndex((s:any)=>s.kind!==first.kind||s.input.model!==first.input.model)),operation:first.kind==='image'?'Image generation':first.kind==='video'?'Video generation with native audio':'Voiceover generation'});
  if((remaining.length||p!.steps.some((s:any)=>s.status==='completed'))&&!p!.estimate.missingPricing?.length && p!.estimate.credits!=null)for(const group of groups){
   const credits=group.credits??group.steps.reduce((n:number,s:any)=>n+s.credits,0);const hash=approvalSignature(p,group.scope,group.steps,credits);
   await CreditApproval.findOneAndUpdate({userId,productionId,scope:group.scope,signature:hash},{$setOnInsert:{conversationId,operation:group.operation,models:[...new Set(group.steps.flatMap((s:any)=>[s.input.model,...(s.input.requestLimits?.fallbacks||[]).map((f:any)=>f.model)])),...(group.scope==='production'&&p!.settings.autoExport?['FFmpeg MP4']:[])],quantity:group.steps.length+(group.scope==='production'&&p!.settings.autoExport?1:0),credits,stepKeys:group.steps.map((s:any)=>s.key),expiresAt:p!.expiresAt}},{upsert:true,new:true});
  }
 }
 const records=await CreditApproval.find({userId,productionId}).sort({createdAt:1});
 const wallet=await Wallet.findOne({userId}).select('availableCredits reservedCredits spentCredits').lean();
 const reviewed=!p!.snapshot.requiresScriptReview||!!await AIProject.exists({_id:p!.projectId,userId,approvedAt:{$ne:null}});
 const cards=[];for(const record of records){
  const selected=p!.steps.filter((s:any)=>record.stepKeys.includes(s.key));const reserve=record.reservationId?await CreditReservation.findOne({_id:record.reservationId,userId}).select('credits remainingCredits status').lean():null;
  if(record.status==='approved'&&reserve&&reserve.status!=='reserved'){
   const {VideoExport}=await import('../models/VideoEdit.js');const failedExport=await VideoExport.exists({productionId:p!._id,userId,reservationId:record.reservationId,status:'failed'});
   record.status=selected.every((s:any)=>['completed','skipped'].includes(s.status))&&!failedExport?'completed':'failed';record.completedAt=new Date();await record.save();
  }
  const {VideoExport}=await import('../models/VideoEdit.js');const render=record.scope==='production'&&p!.settings.autoExport&&record.reservationId?await VideoExport.findOne({productionId:p!._id,userId,reservationId:record.reservationId}).select('status progress').sort({createdAt:-1}).lean():null;
  const {LedgerEntry}=await import('../models/LedgerEntry.js');const settled=record.reservationId?(await LedgerEntry.find({userId,type:'settlement','metadata.reservationId':String(record.reservationId)}).select('amountCredits').lean()).reduce((n,e)=>n-Math.min(0,e.amountCredits),0):0;
  const activity=await StudioEvent.find({productionId:p!._id,userId,...(record.scope==='operation'?{stepKey:{$in:record.stepKeys}}:{})}).select('message level createdAt').sort({createdAt:-1}).limit(30).lean();
  cards.push({...publicApproval(record),render,blockedReason:!reviewed?'Review and approve the script before generating media.':undefined,activity:activity.reverse().map(e=>({...e,message:/usd|profit|margin|\$/i.test(e.message)?'Generation stopped; completed work is preserved.':e.message})),progress:{completed:selected.filter((s:any)=>['completed','skipped'].includes(s.status)).length+(render?.status==='completed'?1:0),total:selected.length+(record.scope==='production'&&p!.settings.autoExport?1:0),productionStatus:p!.status},transaction:reserve?{status:reserve.status,reserved:reserve.credits,remaining:reserve.remainingCredits??reserve.credits,settled}:null});
 }
 return {approvals:cards,wallet};
}
export async function approveCreditCard(userId:string,approvalId:string,credits:number,ready=async()=>env.STUDIO_QUEUE_ENABLED&&persistentStorageConfigured()&&Boolean(env.OPENROUTER_API_KEY||env.GEMINI_API_KEY)&&await studioWorkerOnline()){
 const original=await CreditApproval.findOne({_id:approvalId,userId});if(!original)fail('Approval not found',404);if(original!.status==='approved'||original!.status==='completed')return publicApproval(original);
 if(original!.status!=='pending')fail('This request is no longer awaiting approval');
 if(!await ready())fail('Generation is temporarily unavailable. Nothing has been charged.',503);
 const session=await mongoose.startSession();let updated:any;
 try{await session.withTransaction(async()=>{
  const a=await CreditApproval.findOne({_id:approvalId,userId}).session(session);if(!a)fail('Approval not found',404);if(a!.status==='approved'||a!.status==='completed'){updated=a;return;}if(a!.status!=='pending')fail('This request is no longer awaiting approval');
  const p=await StudioProduction.findOne({_id:a!.productionId,userId}).session(session);if(!p||p.control==='cancel'||!['draft','paused'].includes(p.status)||p.leaseUntil&&p.leaseUntil>new Date())fail('Wait for the current operation to finish');
  if(p!.activeApprovalId&&await CreditApproval.exists({_id:p!.activeApprovalId,userId,status:'approved'}).session(session))fail('Resume or cancel the current approved operation before approving another');
  if(p!.approvedAt&&p!.approvalMode!=='cards')fail('This production already has an approved budget');
  if(!a!.expiresAt||a!.expiresAt<new Date())fail('This quote expired. Prepare an updated production plan.');
  if(credits!==a!.credits)fail('Approve the exact displayed credit amount');
  const remaining=unfinished(p),selected=remaining.filter((s:any)=>a!.stepKeys.includes(s.key));
  if(selected.length!==a!.stepKeys.length||approvalSignature(p,a!.scope!,selected,a!.credits)!==a!.signature)fail('The production plan changed. Review a new approval.');
  if(a!.scope==='production'&&remaining.length!==selected.length)fail('The production scope changed');
  if(p!.snapshot.requiresScriptReview&&!await AIProject.exists({_id:p!.projectId,userId,approvedAt:{$ne:null}}).session(session))fail('Review and approve the script before generating media');
  if(p!.snapshot.product&&!(await (await import('./creditPricingEngine.js')).getPricingPolicy()).values.commercialEnabled)fail('Product commercials are currently unavailable');
  if(a!.scope==='production'&&p!.settings.autoExport&&!env.RENDER_QUEUE_ENABLED)fail('Video rendering is temporarily unavailable',503);
  if(p!.sourceProductionId){const source=await StudioProduction.findOne({_id:p!.sourceProductionId,userId}).session(session);if(source&&!['completed','cancelled'].includes(source.status)){if(!['paused','failed','needs_review'].includes(source.status)||source.leaseUntil&&source.leaseUntil>new Date())fail('Pause the source production before approving its replacement');source.status='cancelled';source.control='cancel';await source.save({session});if(source.reservationId)await closeStudioReserve(String(source.reservationId),'replaced_by_approved_plan',session);}}
  const reserve=await reserveCredits(userId,{credits:a!.credits,feature:'ai_studio_production',productionId:p!._id,approvalId:a!._id,...(selected.some((s:any)=>s.input.model.startsWith('openrouter/'))?{provider:'openrouter',estimatedCostUsd:selected.filter((s:any)=>!s.reused&&s.input.model.startsWith('openrouter/')).reduce((n:number,s:any)=>n+Number(s.pricing?.providerCostUsd||0),0)}:{})},'agent-approval:'+a!._id,session);
  a!.status='approved';a!.decidedAt=new Date();a!.reservationId=reserve._id;await a!.save({session});updated=a;
  p!.approvalMode='cards';p!.activeApprovalId=a!._id;p!.reservationId=reserve._id;p!.maxCredits=p!.steps.filter((s:any)=>s.charged).reduce((n:number,s:any)=>n+s.credits,0)+a!.credits;p!.approvedAt=new Date();p!.status='awaiting_credit_execution';p!.control='run';p!.queueRevision++;await p!.save({session});
  await CreditApproval.updateMany({productionId:p!._id,userId,status:'pending',_id:{$ne:a!._id}},{$set:{status:'superseded'}},{session});
 });}finally{await session.endSession();}
 const production=await StudioProduction.findOne({_id:updated.productionId,userId});await studioLog(production,'waiting','Credit approval accepted: '+updated.operation+' / '+updated.credits+' credits.');await enqueueStudio(production).catch(()=>null);return publicApproval(updated);
}
export async function rejectCreditCard(userId:string,approvalId:string){
 const session=await mongoose.startSession();let result:any;
 try{await session.withTransaction(async()=>{
 const a=await CreditApproval.findOne({_id:approvalId,userId}).session(session);if(!a)fail('Approval not found',404);if(a!.status==='rejected'){result=a;return;}if(a!.status!=='pending')fail('This request cannot be rejected after execution was authorized');
 const p=await StudioProduction.findOne({_id:a!.productionId,userId}).session(session);if(!p||!['draft','paused'].includes(p.status)||p.leaseUntil&&p.leaseUntil>new Date())fail('The production is active; pause it before changing the plan');
 a!.status='rejected';a!.decidedAt=new Date();await a!.save({session});result=a;
 if(a!.scope==='operation'){
 const selected=p!.steps.filter((s:any)=>a!.stepKeys.includes(s.key));if(selected.some((s:any)=>s.status!=='pending'))fail('This operation has already started');
 const rejectedImages=new Set(selected.filter((s:any)=>s.kind==='image').map((s:any)=>s.sceneId));
 p!.steps=p!.steps.map((s:any)=>a!.stepKeys.includes(s.key)||s.kind==='video'&&rejectedImages.has(s.sceneId)?{...s,status:'skipped',error:'Skipped because the user rejected this operation or its image dependency'}:s);p!.markModified('steps');await p!.save({session});
 await CreditApproval.updateMany({userId,productionId:p!._id,status:'pending'},{$set:{status:'superseded'}},{session});
 }
 if(a!.conversationId)await AIConversation.updateOne({_id:a!.conversationId,userId},{$push:{messages:{role:'assistant',content:a!.operation+' was rejected. No credits were reserved. This operation was skipped; ask me to adjust the plan.',metadata:{approvalId:String(a!._id),rejected:true}}}},{session});
 });}finally{await session.endSession();}
 await studioLog({ _id:result.productionId,userId },'cancelled',result.operation+' rejected; no generation or credit reservation.');return publicApproval(result);
}
export async function finishCreditCard(p:any,status:'completed'|'failed'){
 if(p.approvalMode!=='cards'||!p.activeApprovalId)return;
 await closeStudioReserve(String(p.reservationId),status==='completed'?'approved_operation_complete':'approved_operation_failed');
 await CreditApproval.updateOne({_id:p.activeApprovalId,userId:p.userId,status:'approved'},{$set:{status,completedAt:new Date()}});
}
