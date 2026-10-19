import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {MongoMemoryReplSet} from "mongodb-memory-server";
import {fileURLToPath} from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import {researchAgentRouter} from "../dist/routes/researchAgent.js";
import {studioRouter} from "../dist/routes/studio.js";
import {AgentTask} from "../dist/models/AgentTask.js";
import {ScriptJob} from "../dist/models/ScriptJob.js";
import {AIProject} from "../dist/models/AIProject.js";
import {AIConversation} from "../dist/models/AIConversation.js";
import {StudioProduction} from "../dist/models/StudioProduction.js";
import {CreditPackage} from "../dist/models/CreditPackage.js";
import {CreditReservation} from "../dist/models/CreditReservation.js";
import {GenerationPriceRule} from "../dist/models/GenerationPriceRule.js";
import {Wallet} from "../dist/models/Wallet.js";
import {User} from "../dist/models/User.js";
import {Session} from "../dist/models/Session.js";
import {hashSecret} from "../dist/utils/crypto.js";
import {processScriptJob} from "../dist/services/scriptProduction.js";
import {advanceStoryTask,continueStoryTask,isStoryIntent} from "../dist/services/agentStory.js";
import {env} from "../dist/config/env.js";
let db,server,base,user;const original=fetch;let externalCalls=0;
const headers={"Content-Type":"application/json",Cookie:"drex_session=story-agent","x-csrf-token":"csrf"};
const productionSettings={imageModel:"openrouter/black-forest-labs/flux-3-image-klein",videoModel:"openrouter/alibaba/wan-3.0",voiceModel:"openrouter/elevenlabs/eleven-flash-v2.5",video:false,narration:true,targetSeconds:90};
before(async()=>{
 db=await MongoMemoryReplSet.create({replSet:{count:1},instanceOpts:[{launchTimeout:60000}],binary:{downloadDir:fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server",import.meta.url))}});await mongoose.connect(db.getUri("agent_story"));
 await Promise.all([AgentTask,ScriptJob,StudioProduction,Wallet,CreditReservation].map(m=>m.init()));env.OPENROUTER_API_KEY="fixture-only";
 user=await User.create({email:"story-agent@example.test",displayName:"Fixture",passwordHash:"test",status:"active"});await Session.create({userId:user._id,tokenHash:hashSecret("story-agent"),csrfTokenHash:hashSecret("csrf"),expiresAt:new Date(Date.now()+3600000)});
 await Wallet.create({userId:user._id,availableCredits:272});await CreditPackage.create({key:"creator",name:"Creator",amount:90,credits:5000,currency:"USD",active:true});
 await GenerationPriceRule.create({feature:"text_to_image",provider:"gemini",model:productionSettings.imageModel,unit:"image:1K",creditsPerUnit:2,providerCostUsd:.001,active:true});
 globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/images/models'))return Response.json({data:[{id:'black-forest-labs/flux-3-image-klein',architecture:{output_modalities:['image']}}]});if(String(url).includes('/images/models/')&&String(url).endsWith('/endpoints'))return Response.json({endpoints:[{provider_name:'Fixture',pricing:[{billable:'output_image',unit:'image',variant:'1K',cost_usd:'.002'}]}]});if(String(url).startsWith("https://openrouter.ai")&&/\/models(?:\?output_modalities=speech)?$/.test(String(url)))return Response.json({data:[{id:"fixture/story-paid",architecture:{output_modalities:["text"]},supported_parameters:["max_tokens","response_format"],context_length:64000,pricing:{prompt:"0.000001",completion:"0.000002"}},{id:'fixture/story-backup',architecture:{output_modalities:['text']},supported_parameters:['max_tokens','response_format'],context_length:64000,pricing:{prompt:'.000002',completion:'.000003'}},{id:'elevenlabs/eleven-flash-v2.5',architecture:{output_modalities:['speech']},supported_voices:['george'],pricing:{prompt:'.00002',completion:'0'}}]});if(String(url).startsWith("https://openrouter.ai")&&String(url).endsWith("/key"))return Response.json({data:{limit_remaining:10}});if(String(url).startsWith("http://127.0.0.1:"))return original(url,options);externalCalls++;throw new Error("Unexpected external request");};
 const app=express();app.use(express.json(),cookieParser());app.use("/api/ai",researchAgentRouter);app.use("/api/studio",studioRouter);server=await new Promise(r=>{const s=app.listen(0,"127.0.0.1",()=>r(s));});base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{globalThis.fetch=original;server.closeAllConnections();await new Promise(r=>server.close(r));await mongoose.disconnect();await db.stop();});
async function post(path,body){const response=await original(base+path,{method:"POST",headers,body:JSON.stringify(body)});return response;}
function scene(n){return {order:n,title:"Scene "+n,sceneDescription:"Original ocean discovery",characters:[],narration:Array(70).fill("original").join(" "),dialogue:"",imagePrompt:"Original city scene "+n,videoMotionPrompt:"Camera tracks discovery",cameraDirection:"Wide shot",estimatedNarrationTiming:"30 seconds",audioSuggestions:"Ocean",transitionSuggestions:"Cut"};}
function scriptProvider(fail=false){let calls=[];return {calls,request:async input=>{const args=JSON.parse(input.prompt);if(args.sceneCount){calls.push("plan");return JSON.stringify({title:"Saved ocean story",storyConcept:"A discovery",summary:"Original story",characters:[],scenes:[1,2,3].map(n=>({title:"Scene "+n,purpose:"Develop story",duration:30}))});}calls.push(args.startOrder);if(fail&&args.startOrder===3)throw Object.assign(new Error("Provider rejected request"),{providerRejected:true,status:400});return JSON.stringify(Object.fromEntries(args.requiredSceneKeys.map((key,i)=>[key,scene(args.startOrder+i)])));}};}
async function newTask(){const response=await post("/api/ai/agent/chat",{workspace:"production",message:"Create a three-scene story about a hidden ocean city",requestId:crypto.randomUUID(),productionSettings,approvedCredits:0,fastChat:true});assert.equal(response.status,200);const stream=await response.text();assert.doesNotMatch(stream,/lookup_channel|event: error/);return (await AgentTask.findOne({userId:user._id}).sort({createdAt:-1}));}
test("three-scene story uses durable Script Builder, saves scenes and prepares a real storyboard plan",async()=>{
 const task=await newTask();assert.equal(task.status,"awaiting_approval");assert.equal(task.input.settings.sceneCount,3);assert.equal(await ScriptJob.countDocuments(),0);assert.equal((await Wallet.findOne({userId:user._id})).availableCredits,272);
 const approved=await Promise.all([post(`/api/ai/agent/tasks/${task._id}/approve`,{approvedCredits:task.quote.credits}),post(`/api/ai/agent/tasks/${task._id}/approve`,{approvedCredits:task.quote.credits})]);assert.ok(approved.every(r=>r.status===200));assert.equal(await ScriptJob.countDocuments(),1);
 const job=await ScriptJob.findOne(),provider=scriptProvider();await processScriptJob(job,provider.request);await advanceStoryTask(String(task._id));
 const result=await (await original(base+`/api/ai/agent/tasks/${task._id}`,{headers})).json();assert.equal(result.task.status,"completed",result.task.error);assert.equal(result.project.scenes.length,3);assert.ok(result.project.scenes.every(s=>s._id&&s.imagePrompt&&s.videoMotionPrompt));assert.equal(result.production.steps.filter(s=>s.kind==="image").length,3);assert.equal(result.production.snapshot.requiresScriptReview,true);assert.equal(result.production.status,"draft");assert.ok(result.production.steps.some(s=>s.kind==="audio"&&s.input.voiceId==="george"));
 const wallet=await Wallet.findOne({userId:user._id});assert.equal(wallet.availableCredits,272-task.quote.credits);assert.equal(wallet.spentCredits,task.quote.credits);assert.ok(task.quote.estimatedCostUsd>0);assert.ok(task.quote.credits>1);assert.equal(externalCalls,0);assert.deepEqual(provider.calls,["plan",1,3]);
 await advanceStoryTask(String(task._id));assert.equal(await ScriptJob.countDocuments(),1);assert.equal(await StudioProduction.countDocuments(),1);
 assert.equal(String((await AIConversation.findById(task.conversationId)).projectId),result.project._id);
 const blocked=await post(`/api/studio/productions/${result.production._id}/approve`,{maxCredits:result.production.estimate.credits});assert.equal(blocked.status,503);
});
test("failed writing preserves completed scenes; approved continuation writes only the missing batch",async()=>{
 const before=await Wallet.findOne({userId:user._id}),task=await newTask();await post(`/api/ai/agent/tasks/${task._id}/approve`,{approvedCredits:task.quote.credits});
 let saved=await AgentTask.findById(task._id);const job=await ScriptJob.findById(saved.scriptJobId);const failing=scriptProvider(true);await processScriptJob(job,failing.request);await advanceStoryTask(String(task._id));
 saved=await AgentTask.findById(task._id);assert.equal(saved.status,"failed");const partial=await ScriptJob.findById(saved.scriptJobId);assert.equal(partial.cursor,2);const project=await AIProject.findById(partial.resultProjectId);assert.equal(project.scenes.length,2);assert.equal((await Wallet.findOne({userId:user._id})).availableCredits,before.availableCredits);
 const continued=await continueStoryTask(String(user._id),String(task._id));assert.equal(continued.status,"awaiting_approval");await post(`/api/ai/agent/tasks/${task._id}/approve`,{approvedCredits:continued.quote.credits});
 const provider=scriptProvider();await processScriptJob(await ScriptJob.findById(partial._id),provider.request);await advanceStoryTask(String(task._id));assert.deepEqual(provider.calls,[3]);assert.equal((await AIProject.findById(project._id)).scenes.length,3);assert.equal((await Wallet.findOne({userId:user._id})).spentCredits,before.spentCredits+continued.quote.credits);assert.equal(externalCalls,0);
});
test("task endpoints protect ownership and do not infer channel research from story intent",async()=>{
 assert.equal(isStoryIntent("Create a three-scene story"),true);assert.equal(isStoryIntent("Research this YouTube channel"),false);
 const task=await newTask();const other=await User.create({email:"other-story@example.test",displayName:"Other",passwordHash:"x",status:"active"});const foreign=await AgentTask.create({userId:other._id,conversationId:new mongoose.Types.ObjectId(),requestId:crypto.randomUUID(),input:task.input,quote:task.quote});
 const response=await original(base+`/api/ai/agent/tasks/${foreign._id}`,{headers});assert.equal(response.status,404);
});

test("production-plan retry preserves the completed script and never bills it again",async()=>{
 const task=await newTask();await post('/api/ai/agent/tasks/'+task._id+'/approve',{approvedCredits:task.quote.credits});
 const running=await AgentTask.findById(task._id);await processScriptJob(await ScriptJob.findById(running.scriptJobId),scriptProvider().request);
 const job=await ScriptJob.findById(running.scriptJobId),project=await AIProject.findById(job.resultProjectId||job.projectId);
 const before=await Wallet.findOne({userId:user._id});const jobs=await ScriptJob.countDocuments();
 await AgentTask.updateOne({_id:task._id},{$set:{'input.productionSettings.resolution':'unsupported-fixture-resolution'}});
 await advanceStoryTask(String(task._id));const failed=await AgentTask.findById(task._id);assert.equal(failed.status,'failed');assert.equal(failed.stage,'production_plan');assert.equal(String(failed.projectId),String(project._id));
 await AgentTask.updateOne({_id:task._id},{$set:{'input.productionSettings':productionSettings}});
 const resumed=await continueStoryTask(String(user._id),String(task._id));assert.equal(resumed.status,'completed');assert.equal(await ScriptJob.countDocuments(),jobs);assert.equal((await Wallet.findOne({userId:user._id})).spentCredits,before.spentCredits);assert.equal(externalCalls,0);
});

test('paid-only chat survives a definite 502 using an approved compatible fallback without wallet deductions',async()=>{
 const {routerText}=await import('../dist/services/openrouter.js');const {assistantModel}=await import('../dist/services/assistantRouting.js');const {freeChatTerms}=await import('../dist/services/chatAccess.js');
 assert.doesNotMatch(await assistantModel('story_generation','free',String(user._id)),/:free$/);
 const terms=await freeChatTerms(String(user._id));assert.equal(terms.credits,0);assert.ok(terms.estimatedCostUsd>0);assert.doesNotMatch(terms.model,/:free$/);
 const normal=globalThis.fetch,before=await Wallet.findOne({userId:user._id});let calls=[];
 try{globalThis.fetch=async(url,options)=>{if(String(url).endsWith('/chat/completions')){const body=JSON.parse(options.body);calls.push(body.model);return body.model==='fixture/story-paid'?Response.json({error:{message:'Provider returned error'}},{status:502}):Response.json({id:'paid-fallback-fixture',choices:[{message:{content:'Analysis completed'},finish_reason:'stop'}],usage:{cost:.001}});}return normal(url,options);};
 const result=await routerText({model:'openrouter/fixture/story-paid',system:'Analyze public metadata',prompt:'Original angle',requestLimits:{maxInputTokens:20000,maxOutputTokens:1200,approvedCostUsd:.1,fallbacks:[{model:'openrouter/fixture/story-backup',maxPrice:{prompt:10,completion:10}}]}});
 assert.equal(result,'Analysis completed');assert.deepEqual(calls,['fixture/story-paid','fixture/story-backup']);const after=await Wallet.findOne({userId:user._id});assert.equal(after.availableCredits,before.availableCredits);
 }finally{globalThis.fetch=normal;}
});
