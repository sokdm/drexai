import mongoose from "mongoose";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AgentTask} from "../models/AgentTask.js";
import {ScriptJob} from "../models/ScriptJob.js";
import {AIProject} from "../models/AIProject.js";
import {AIConversation} from "../models/AIConversation.js";
import {scriptSettings,scriptShape} from "./scriptProduction.js";
import {assistantModel} from "./assistantRouting.js";
import {createQuote,reserveCredits,releaseReservation} from "./wallet.js";
import {prepareProduction} from "./productionTools.js";
import {studioSettingsSchema} from "./studioPlan.js";
export function isStoryIntent(message:string){return /\b(create|write|generate|develop|draft|make|tell|want|need|build)\b/i.test(message)&&/\b(story|script|scenes?|storyboard|narrative|film|movie|video)\b/i.test(message)&&!/\b(analy[sz]e|research|lookup|look up|search|compare)\b/i.test(message);}
export function storyArguments(message:string){
 const count=message.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[ -]scenes?\b/i);
 const words=["one","two","three","four","five","six","seven","eight","nine","ten"];
 const sceneCount=count?(Number(count[1])||words.indexOf(count[1].toLowerCase())+1):3;
 const duration=message.match(/\b(\d{1,3})[ -](seconds?|minutes?)\b/i);
 return scriptSettings.parse({storyTopic:message,sceneCount:Math.min(40,Math.max(1,sceneCount)),targetDuration:duration?duration[1]+" "+duration[2]:sceneCount*30+" seconds",modelMode:"auto",type:"Video production"});
}
export function diagnoseAgent(stage:string,error:any,context:any={}){console.warn(JSON.stringify({event:"agent_failure",stage,taskId:context.taskId,requestId:context.requestId,code:error.code,status:error.status||error.statusCode,finishReason:error.finishReason,maxOutputTokens:error.maxOutputTokens,name:error.name}));}
export async function storyQuote(userId:string,settings:any,quantity=scriptShape(settings).calls,usePaid=false){const model=await assistantModel("story_generation",usePaid?"paid":"auto",userId,quantity);const quote:any=await createQuote({feature:"story_generation",provider:"openrouter",model,quantity});if(!quote.allowed)throw Object.assign(new Error("Script creation is temporarily unavailable. Your credits have not been charged."),{code:"SCRIPT_QUOTE_UNAVAILABLE"});return quote;}
export async function createStoryTask(userId:string,conversationId:string,message:string,requestId:string,productionSettings?:unknown){
 const previous=await AgentTask.findOne({userId,requestId});if(previous)return previous;
 const settings=storyArguments(message),quote=await storyQuote(userId,settings);
 const task=await AgentTask.create({userId,conversationId,requestId,input:{settings,productionSettings:productionSettings?studioSettingsSchema.parse(productionSettings):undefined},quote,events:[{tool:"script_builder",status:"awaiting_approval",message:"Create "+settings.sceneCount+" saved scenes. Approve "+quote.credits+" credits before the creation tool starts.",at:new Date()}]}).catch(async(error:any)=>{if(error.code===11000){const existing=await AgentTask.findOne({userId,requestId});if(existing)return existing;}throw error;});
 await AIConversation.updateOne({_id:conversationId,userId},{$push:{messages:{role:"assistant",content:"I prepared a "+settings.sceneCount+"-scene script task. Review the creation cost below. No generation has started.",metadata:{taskId:String(task._id)}}}});return task;
}
export async function approveStoryTask(userId:string,taskId:string,approvedCredits:number){
 const session=await mongoose.startSession();
 try{await session.withTransaction(async()=>{
 const task=await AgentTask.findOne({_id:taskId,userId}).session(session);if(!task)throw new Error("Task not found");if(task.status!=="awaiting_approval")return;
 if(new Date(task.quote.expiresAt)<new Date())throw new Error("This creation quote expired. Refresh the task quote before approving.");
 if(approvedCredits!==task.quote.credits)throw new Error("Approve the exact displayed creation cost");
 const reserve=await reserveCredits(userId,task.quote,"agent-script:"+task._id+":"+(task.scriptJobId?"resume":"start")+":"+task.quote.expiresAt,session);
 let job:any;
 if(task.scriptJobId){job=await ScriptJob.findOneAndUpdate({_id:task.scriptJobId,userId,status:"failed",inFlight:{$ne:true}},{$set:{quote:task.quote,reservationId:reserve._id,status:"queued",error:"",inFlight:false},$unset:{leaseUntil:1}},{new:true,session});if(!job)throw new Error("This request cannot be safely replayed. Saved progress is available for review.");}
 else{[job]=await ScriptJob.create([{userId,requestId:randomUUID(),status:"queued",input:{settings:task.input.settings},quote:task.quote,reservationId:reserve._id,logs:[{stage:"waiting",message:"Agent creation tool approved; script worker queued.",at:new Date()}]}],{session});}
 task.scriptJobId=job._id;task.approvedAt=new Date();task.status="running";task.error=undefined;task.events.push({tool:"script_builder",status:"queued",message:"Approved script generation queued. Progress is saved after every stage.",at:new Date()});await task.save({session});
 });}finally{await session.endSession();}return AgentTask.findOne({_id:taskId,userId});
}
export async function advanceStoryTask(taskId:string){
 const task=await AgentTask.findOneAndUpdate({_id:taskId,status:"running",$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}]},{$set:{leaseUntil:new Date(Date.now()+120000)}},{new:true});if(!task)return;
 try{
 const job=await ScriptJob.findOne({_id:task.scriptJobId,userId:task.userId});if(!job)throw new Error("Saved script request is unavailable");
 if(["failed","needs_review"].includes(job.status)){task.status=job.status==="needs_review"?"needs_review":"failed";task.error="The script step stopped. Completed scenes are saved. "+(task.status==="needs_review"?"The last provider request needs review before it can be safely repeated.":"Continue to retry the unfinished work after reviewing its quote.");await releaseReservation(String(job.reservationId),"agent_script_stopped");await task.save();return;}
 if(job.status!=="completed")return;
 const project=await AIProject.findOne({_id:job.projectId||job.resultProjectId,userId:task.userId});if(!project||!project.scenes.length)throw new Error("Script job has no saved scenes");
 task.projectId=project._id;task.stage="production_plan";await task.save();
 await AIConversation.updateOne({_id:task.conversationId,userId:task.userId},{$set:{projectId:project._id}});
 if(!task.productionId && task.input.productionSettings){
 const existing=await (await import("../models/StudioProduction.js")).StudioProduction.findOne({"snapshot.agentTaskId":String(task._id),userId:task.userId});
 const production=existing||await prepareProduction(String(task.userId),{projectId:String(project._id),settings:task.input.productionSettings},true,String(task._id));

 task.productionId=production._id;
 }
 task.status="completed";task.error=undefined;task.events.push({tool:"save_project",status:"completed",message:project.scenes.length+" scenes saved to "+project.title,at:new Date()});
 task.events.push({tool:"production_plan",status:"completed",message:task.productionId?"Storyboard and priced media plan saved. Review scenes before approving media generation.":"Storyboard saved. Select media settings in AI Studio to prepare a generation plan.",at:new Date()});await task.save();
 await AIConversation.updateOne({_id:task.conversationId,userId:task.userId,"messages.metadata.completedTask":{$ne:String(task._id)}},{$push:{messages:{role:"assistant",content:"Saved "+project.scenes.length+" scenes in "+project.title+". Your storyboard is ready. Images and videos require a separate media budget approval.",metadata:{taskId:String(task._id),completedTask:String(task._id)}}}});
 }catch(error:any){diagnoseAgent(task.stage,error,{taskId:String(task._id)});await AgentTask.updateOne({_id:task._id},{$set:{status:"failed",error:"The next production step could not finish. Your script and completed scenes are saved. Continue retries this step only."}});}finally{await AgentTask.updateOne({_id:task._id},{$unset:{leaseUntil:1}});}
}
export async function continueStoryTask(userId:string,taskId:string,usePaid=false){
 const task=await AgentTask.findOne({_id:taskId,userId});if(!task)throw new Error("Task not found");
 if(task.status==="completed"||task.status==="running")return task;
 if(task.stage==="production_plan"){await AgentTask.updateOne({_id:taskId,userId},{$set:{status:"running",error:""}});await advanceStoryTask(taskId);return AgentTask.findOne({_id:taskId,userId});}
 if(task.status==="rejected")throw new Error("This operation was rejected. Send a new request to change the plan.");
 if(task.status==="needs_review")throw new Error("The last provider request has an uncertain outcome. Review saved scenes before starting another paid request.");
 let calls=scriptShape(task.input.settings).calls;
 if(task.scriptJobId){const job=await ScriptJob.findOne({_id:task.scriptJobId,userId});if(job?.inFlight)throw new Error("Wait for the provider request to finish");calls=Math.max(1,Math.ceil((scriptShape(task.input.settings).scenes-(job?.cursor||0))/2)+(job?.plan?0:1));}
 const quote=await storyQuote(userId,task.input.settings,calls,usePaid);task.quote=quote;task.status="awaiting_approval";task.error=undefined;await task.save();return task;
}
export function startAgentTaskWorker(){let busy=false;const tick=async()=>{if(busy)return;busy=true;try{const tasks=await AgentTask.find({status:"running",$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lt:new Date()}}]}).select("_id").limit(10);for(const task of tasks)await advanceStoryTask(String(task._id));}catch(e:any){diagnoseAgent("worker",e);}finally{busy=false;}};const timer=setInterval(()=>void tick(),3000);timer.unref();return()=>clearInterval(timer);}

export function publicStoryTask(task:any){const value=task.toObject?task.toObject():task;return {...value,quote:{credits:value.quote.credits,model:value.quote.model,fallbackModels:(value.quote.requestLimits?.fallbacks||[]).map((f:any)=>f.model),quantity:value.input.settings.sceneCount,expiresAt:value.quote.expiresAt,allowed:value.quote.allowed}};}
export async function rejectStoryTask(userId:string,taskId:string){
 const task=await AgentTask.findOneAndUpdate({_id:taskId,userId,status:"awaiting_approval"},{$set:{status:"rejected",rejectedAt:new Date()},$push:{events:{tool:"script_builder",status:"rejected",message:"Script creation rejected. No credits were reserved; ask the agent to revise the plan.",at:new Date()}}},{new:true});
 if(!task){const previous=await AgentTask.findOne({_id:taskId,userId});if(previous?.status==="rejected")return previous;throw new Error("This operation is no longer awaiting approval");}
 await AIConversation.updateOne({_id:task.conversationId,userId},{$push:{messages:{role:"assistant",content:"Script creation was rejected. No credits were reserved. Tell me how to adjust the plan.",metadata:{taskId:String(task._id),rejected:true}}}});return task;
}
