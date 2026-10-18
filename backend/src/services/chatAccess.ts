import mongoose,{Schema,model} from "mongoose";
import {randomUUID} from "node:crypto";
import {getPricingPolicy,estimateRouterCost} from "./creditPricingEngine.js";
import {routerCatalog} from "./openrouter.js";
import {verifiedFreeText,freeAiAvailable} from "./freeAiLimits.js";
import {assertProviderBudget,defaultModel} from "./platformControl.js";
const usageSchema=new Schema({_id:String,count:{type:Number,default:0},expiresAt:Date});usageSchema.index({expiresAt:1},{expireAfterSeconds:0});
export const ChatUsage=model("ChatUsage",usageSchema);
const admissionSchema=new Schema({_id:String,expiresAt:Date});admissionSchema.index({expiresAt:1},{expireAfterSeconds:0});
const ChatAdmission=model("ChatAdmission",admissionSchema);
export const CHAT_WINDOW_MS=4*60*60*1000;
export function chatWindow(now=new Date()){const start=Math.floor(now.getTime()/CHAT_WINDOW_MS)*CHAT_WINDOW_MS;return {key:String(start),resetsAt:new Date(start+CHAT_WINDOW_MS)};}
export async function chatStatus(userId:string,now=new Date()){
 const {values}=await getPricingPolicy(),window=chatWindow(now),limit=values.chatMessagesPerWindow;
 const row=await ChatUsage.findById(userId+":"+window.key).lean();
 return {limit,used:row?.count||0,remaining:Math.max(0,limit-(row?.count||0)),resetsAt:window.resetsAt,windowHours:4};
}
function limitError(resetsAt:Date){return Object.assign(new Error("You've reached your free chat limit. You can chat again when your four-hour allowance resets."),{code:"CHAT_LIMIT",statusCode:429,resetsAt});}
export async function admitChatMessage(userId:string,key:string=randomUUID(),now=new Date()){
 if(!mongoose.isValidObjectId(userId))throw new Error("Sign in to use the assistant.");
 const status=await chatStatus(userId,now),window=chatWindow(now),id=userId+":"+window.key;
 try{await ChatUsage.updateOne({_id:id},{$setOnInsert:{count:0,expiresAt:new Date(window.resetsAt.getTime()+CHAT_WINDOW_MS)}},{upsert:true});}catch(e:any){if(e.code!==11000)throw e;}
 const session=await mongoose.startSession();
 try{await session.withTransaction(async()=>{
  if(await ChatAdmission.exists({_id:userId+":"+key}).session(session))return;
  const result=await ChatUsage.updateOne({_id:id,count:{$lt:status.limit}},{$inc:{count:1}},{session});
  if(result.modifiedCount!==1)throw limitError(window.resetsAt);
  await ChatAdmission.create([{_id:userId+":"+key,expiresAt:new Date(window.resetsAt.getTime()+CHAT_WINDOW_MS)}],{session});
 });}finally{await session.endSession();}
 return chatStatus(userId,now);
}
export function publicChatError(error:any){
 if(error.code==="CHAT_LIMIT")return error.message;
 if(error.statusCode===404)return "That conversation or project is no longer available.";
 return "The assistant is temporarily busy. Please try again shortly. Your credits have not been charged.";
}
export async function freeChatTerms(userId:string,requests=2,long=false,vision=false){
 const status=await chatStatus(userId);if(!status.remaining)throw limitError(status.resetsAt);
 const freeAvailable=await freeAiAvailable(userId,requests);
 const {values}=await getPricingPolicy();
 const limits={maxInputTokens:Math.min(long?20000:6000,values.maxInputTokens),maxOutputTokens:Math.min(long?12000:1200,values.maxOutputTokens)};
 const configured=await defaultModel("ai_research_chat","");
 const catalog=await routerCatalog("text");
 const compatible=(r:any)=>r.architecture?.output_modalities?.includes("text")&&(!vision||r.architecture?.input_modalities?.includes("image"))&&r.supported_parameters?.includes("max_tokens")&&r.supported_parameters?.includes("response_format")&&r.context_length>=limits.maxInputTokens+limits.maxOutputTokens;
 const records=catalog.filter((r:any)=>verifiedFreeText(r)&&compatible(r));
 records.sort((a:any,b:any)=>Number("openrouter/"+b.id===configured)-Number("openrouter/"+a.id===configured));
 const models:string[]=[];if(freeAvailable)for(const r of records){try{await assertProviderBudget("openrouter/"+r.id,0);models.push("openrouter/"+r.id);}catch{}if(models.length===2)break;}
 const {env}=await import("../config/env.js");
 const paid=catalog.filter((r:any)=>!verifiedFreeText(r)&&compatible(r));
 paid.sort((a:any,b:any)=>(Number(a.pricing?.prompt)*limits.maxInputTokens+Number(a.pricing?.completion)*limits.maxOutputTokens)-(Number(b.pricing?.prompt)*limits.maxInputTokens+Number(b.pricing?.completion)*limits.maxOutputTokens));
 const candidates=["openrouter/"+env.OPENROUTER_TEXT_FALLBACK_MODEL,...paid.map((r:any)=>"openrouter/"+r.id)];
 const alternatives:any[]=[];let cost=0;
 // Paid vision uses the existing bounded low-resolution motion adapter only.
 for(const model of [...new Set(candidates)].slice(0,6))try{
  const record=catalog.find((r:any)=>"openrouter/"+r.id===model);if(!record||!compatible(record))continue;
  const estimate=await estimateRouterCost({feature:vision?"ai_motion_prompt":"ai_research_chat",model,quantity:requests,settings:vision?{boundedImage:true,multimodal:true}:{fastChat:!long}},values);
  if(!estimate.cost.gt(0)||estimate.cost.gt(Math.min(values.maxJobUsd,values.chatMaxProviderUsd)))continue;
  await assertProviderBudget(model,estimate.cost.toNumber());
  alternatives.push({model,maxPrice:(estimate.limits as any).maxPrice});cost=Math.max(cost,estimate.cost.toNumber());if(alternatives.length===2)break;
 }catch{}
 const maxPrice={prompt:0,completion:0,request:0};
 const routes=models.length?(alternatives.length?[{model:models[0],maxPrice},...alternatives]:models.map(model=>({model,maxPrice}))):alternatives;
 if(!routes.length)throw new Error("No assistant endpoint is currently available");
 return {allowed:true,credits:0,feature:"ai_research_chat",provider:"openrouter",model:routes[0].model,quantity:requests,estimatedCostUsd:cost,pricingSource:"free-chat-four-hour",requestLimits:{...limits,maxPrice:routes[0].maxPrice,approvedCostUsd:cost,freeDeadlineMs:long?60000:8000,fallbacks:routes.slice(1).map(r=>({...r,...(vision?{supportsImages:true}:{})}))},expiresAt:new Date(Date.now()+600000)};
}
