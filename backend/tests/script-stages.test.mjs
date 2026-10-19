import { GatewayUsage } from "../dist/services/openrouter.js";
import { geminiSchema } from "../dist/services/geminiSchema.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { processScriptJob, scriptShape, scriptBatchSchema, scriptExpansionFits } from "../dist/services/scriptProduction.js";
import { ScriptJob } from "../dist/models/ScriptJob.js";
import { AIProject } from "../dist/models/AIProject.js";
import { MediaAsset } from "../dist/models/MediaAsset.js";
import { Wallet } from "../dist/models/Wallet.js";
import { User } from "../dist/models/User.js";
import { reserveCredits, settleReservation } from "../dist/services/wallet.js";
let db,user;
before(async()=>{ db=await MongoMemoryReplSet.create({replSet:{count:1},binary:{downloadDir:fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server",import.meta.url))}});await mongoose.connect(db.getUri("script_stages"));user=await User.create({email:"script-stages@example.test",displayName:"Test",passwordHash:"fixture",status:"active"});await Wallet.create({userId:user._id,availableCredits:1000});});
after(async()=>{await mongoose.disconnect();await db.stop();});
const settings={storyTopic:"An original underwater discovery",type:"Animated story",language:"English",targetDuration:"8 minutes",visualStyle:"Cinematic"};
function scene(order){return{order,title:`Scene ${order}`,sceneDescription:"An original scene",characters:[],narration:Array(70).fill("story").join(" "),dialogue:"",imagePrompt:"Underwater ruins",videoMotionPrompt:"Slow tracking shot",cameraDirection:"Wide angle",estimatedNarrationTiming:"30 seconds",audioSuggestions:"Ocean ambience",transitionSuggestions:"Cut"};}
async function job(extra={}){const quote={credits:9,feature:"story_generation",provider:"fixture",model:"openrouter/fixture/script"};const reservation=await reserveCredits(String(user._id),quote,`fixture:${Math.random()}`);return ScriptJob.create({userId:user._id,requestId:crypto.randomUUID(),status:"processing",reservationId:reservation._id,quote,input:{settings},...extra});}
function mock(failAt=0){let call=0;return async input=>{call++;assert.equal(input.timeoutMs,180000);assert.equal(input.model,"openrouter/fixture/script");if(call===failAt)throw new Error("The operation was aborted due to timeout");if(call===1)return JSON.stringify({title:"The Hidden City",storyConcept:"Discovery",summary:"A complete arc",characters:[],scenes:Array.from({length:16},(_,i)=>({title:`Scene ${i+1}`,purpose:"Develop plot",duration:30}))});const data=JSON.parse(input.prompt);return JSON.stringify(Object.fromEntries(data.requiredSceneKeys.map((key,i)=>[key,scene(data.startOrder+i)])));};}
test("eight-minute generation uses bounded batches and saves a developed script without image calls",async()=>{assert.deepEqual(scriptShape(settings),{seconds:480,scenes:16,calls:9});const j=await job();await processScriptJob(j,mock());const saved=await ScriptJob.findById(j._id);assert.equal(saved.status,"completed");const project=await AIProject.findById(saved.projectId);assert.equal(project.scenes.length,16);assert.equal(project.scenes.reduce((n,s)=>n+s.estimatedDurationSeconds,0),480);assert.equal(await MediaAsset.countDocuments(),0);assert.ok(saved.logs.some(l=>l.stage==="prompts"));});
test("provider timeout preserves completed batches and requires review instead of repeating uncertain paid work",async()=>{const j=await job();await processScriptJob(j,mock(3));const saved=await ScriptJob.findById(j._id);assert.equal(saved.status,"needs_review");assert.equal(saved.cursor,2);assert.equal((await AIProject.findById(saved.resultProjectId)).scenes.length,2);assert.match(saved.error,/timeout/);});
test("safe checkpoint recovery skips completed batches",async()=>{const j=await job();await processScriptJob(j,mock(3));const saved=await ScriptJob.findById(j._id);let calls=0;await processScriptJob(saved,async input=>{calls++;const data=JSON.parse(input.prompt);return JSON.stringify(Object.fromEntries(data.requiredSceneKeys.map((key,i)=>[key,scene(data.startOrder+i)])));});assert.equal(calls,7);assert.equal((await ScriptJob.findById(j._id)).status,"completed");});
test("targeted agent revision changes the real project and preserves other scenes, IDs and a version",async()=>{
 const original=await AIProject.create({userId:user._id,title:"Original title",summary:"Original summary",scenes:Array.from({length:16},(_,i)=>({...scene(i+1),narration:"Keep original words"}))});
 const beforeIds=original.scenes.map(s=>String(s._id));
 const j=await job({input:{settings,projectId:String(original._id),message:"Rewrite Scene 3",snapshot:original.toObject()},baseUpdatedAt:original.updatedAt});
 await processScriptJob(j,mock());const result=await AIProject.findById(original._id);
 assert.equal((await ScriptJob.findById(j._id)).status,"completed");assert.equal(result.scenes[0].narration,"Keep original words");assert.notEqual(result.scenes[2].narration,"Keep original words");assert.deepEqual(result.scenes.map(s=>String(s._id)),beforeIds);assert.equal(result.versions.length,1);assert.equal(result.title,"Original title");
});

test("script worker uses frozen approved token limits rather than the old hardcoded 5000", async()=>{
 const j=await job(); j.quote={...j.quote,requestLimits:{maxInputTokens:20000,maxOutputTokens:12000}}; await j.save(); const response=mock();
 await processScriptJob(j,async input=>{assert.equal(input.maxOutputTokens,12000);assert.equal(input.reasoningEffort,"low");return response(input);});
 assert.equal((await ScriptJob.findById(j._id)).status,"completed");
});

test("truncation preserves saved batches and diagnostics without an unapproved paid retry",async()=>{
 const j=await job();const response=mock();let calls=0;
 await processScriptJob(j,async input=>{calls++;if(calls===3)throw Object.assign(new Error("OpenRouter reached its output token limit"),{code:"INCOMPLETE_PROVIDER_OUTPUT",finishReason:"length",maxOutputTokens:5000,usage:{cost:.001,completion_tokens:5000},requestId:"truncated-fixture"});return response(input);});
 const saved=await ScriptJob.findById(j._id);assert.equal(calls,3);assert.equal(saved.status,"failed");assert.equal(saved.cursor,2);assert.equal(saved.outputFailure.finishReason,"length");assert.equal(saved.outputFailure.requestId,"truncated-fixture");assert.equal((await AIProject.findById(saved.resultProjectId)).scenes.length,2);
});

test("scene response contract requires each requested scene, accepts complete ordered legacy arrays and rejects missing content",()=>{
 const schema=scriptBatchSchema(3,2), json=geminiSchema(schema);
 assert.deepEqual(json.required,["scene_3","scene_4"]);assert.equal(json.properties.scene_3.type,"object");assert.equal(json.additionalProperties,false);
 assert.equal(schema.parse({scene_3:scene(3),scene_4:scene(4)}).scene_4.order,4);
 assert.equal(schema.parse({scenes:[scene(4),scene(3)]}).scene_3.order,3);
 assert.equal(schema.safeParse({scenes:[scene(3)]}).success,false);
 assert.equal(schema.safeParse({scene_3:scene(3)}).success,false);
});
test("an omitted scene never erases saved batches or triggers an additional charged request",async()=>{
 const j=await job(), response=mock();let calls=0;
 await processScriptJob(j,async input=>{calls++;if(calls===3)return JSON.stringify({scene_3:scene(3)});return response(input);});
 const saved=await ScriptJob.findById(j._id);assert.equal(calls,3);assert.equal(saved.status,"failed");assert.equal(saved.cursor,2);assert.match(saved.error,/scene_4/);assert.equal((await AIProject.findById(saved.resultProjectId)).scenes.length,2);
});

test("expansion budget requires verified costs and protects all remaining writing calls",()=>{
 const q={estimatedCostUsd:.09,quantity:9};
 assert.equal(scriptExpansionFits(q,[{costUsd:.002}],7),true);
 assert.equal(scriptExpansionFits(q,[{costUsd:.02}],7),false);
 assert.equal(scriptExpansionFits(q,[{costUsd:undefined}],0),false);
 assert.equal(scriptExpansionFits(q,[],0),false);
});
test("a short valid draft completes with honest duration instead of an error when extra cost is unverified",async()=>{
 const j=await job(),response=mock();let calls=0;
 await processScriptJob(j,async input=>{calls++;if(calls===1)return response(input);const d=JSON.parse(input.prompt);return JSON.stringify(Object.fromEntries(d.requiredSceneKeys.map((key,i)=>[key,{...scene(d.startOrder+i),narration:"The explorer finds a hidden city and faces a difficult decision."}])));});
 const saved=await ScriptJob.findById(j._id),p=await AIProject.findById(saved.projectId);
 assert.equal(saved.status,"completed");assert.equal(calls,9);assert.equal(p.scenes.length,16);assert.equal(p.prompts.partial,false);assert.equal(p.prompts.durationEstimate.needsReview,true);assert.ok(p.prompts.durationEstimate.estimatedSeconds<480);assert.equal(saved.error,undefined);
});
test("short scenes are expanded once within the original approved ceiling without another reservation",async()=>{
 const j=await job();j.quote={...j.quote,estimatedCostUsd:.09,quantity:9};await j.save();const response=mock();let calls=0;
 await processScriptJob(j,async input=>{
  calls++;await GatewayUsage.create({reservationId:j.reservationId,kind:"text",status:"completed",costUsd:.001,requestId:"expand-"+j._id+"-"+calls});
  if(calls===1)return response(input);
  const d=JSON.parse(input.prompt),expanded=input.system.startsWith("Expand");
  return JSON.stringify(Object.fromEntries(d.requiredSceneKeys.map((key,i)=>[key,{...scene(Number(key.split("_")[1])),narration:expanded?Array(75).fill("developed").join(" "):"A brief discovery."}])));
 });
 const saved=await ScriptJob.findById(j._id),p=await AIProject.findById(saved.projectId);
 assert.equal(saved.status,"completed");assert.equal(calls,17);assert.equal(p.prompts.durationEstimate.needsReview,false);assert.equal(p.scenes.length,16);assert.equal(saved.logs.filter(l=>l.stage==="expanding").length,8);assert.equal(String(saved.reservationId),String(j.reservationId));assert.equal(saved.pendingBatch,undefined);
});

test("one-second scripts retain one scene and complete through the durable worker",async()=>{
 const shortSettings={...settings,targetDuration:"1 second"};
 assert.deepEqual(scriptShape(shortSettings),{seconds:1,scenes:1,calls:2});
 const j=await job({input:{settings:shortSettings}});let calls=0;
 await processScriptJob(j,async input=>{calls++;if(calls===1)return JSON.stringify({title:"A Spark",storyConcept:"A discovery",summary:"A light appears",characters:[],scenes:[{title:"Spark",purpose:"Reveal",duration:1}]});
 const data=JSON.parse(input.prompt);assert.equal(data.secondsPerScene,1);assert.deepEqual(data.requiredSceneKeys,["scene_1"]);
 return JSON.stringify({scene_1:{...scene(1),narration:"Light awakens."}});});
 const saved=await ScriptJob.findById(j._id),project=await AIProject.findById(saved.projectId);
 assert.equal(saved.status,"completed");assert.equal(calls,2);assert.equal(project.scenes.length,1);assert.equal(project.targetDuration,"1 second");assert.equal(project.scenes[0].estimatedDurationSeconds,1);assert.equal(project.prompts.durationEstimate.needsReview,false);
});

test("legacy free script quotes cannot reserve even the old one-credit minimum",async()=>{
 const before=await Wallet.findOne({userId:user._id});
 await assert.rejects(()=>reserveCredits(String(user._id),{credits:1,serviceMinimumCredits:1,feature:"story_generation",provider:"openrouter",model:"openrouter/fixture:free"},"free-script-service"),/retired AI route/);
 const after=await Wallet.findOne({userId:user._id});assert.equal(after.availableCredits,before.availableCredits);assert.equal(after.spentCredits,before.spentCredits);
});

test("free script timeouts release the reservation while preserving saved scenes",async()=>{
 const j=await job();j.quote={...j.quote,estimatedCostUsd:0,model:"openrouter/fixture/script:free"};await j.save();
 await processScriptJob(j,async()=>{throw new DOMException("aborted due to timeout","TimeoutError");});
 const saved=await ScriptJob.findById(j._id);assert.equal(saved.status,"failed");assert.match(saved.error,/released/);
 const {CreditReservation}=await import("../dist/models/CreditReservation.js");assert.equal((await CreditReservation.findById(j.reservationId)).status,"released");
});

test('single-scene requests checkpoint separately and disable optional reasoning',async()=>{
 const j=await job({input:{settings:{...settings,sceneCount:3,targetDuration:'20 seconds',sceneBatchSize:1,audioMode:'dialogue'}}});let calls=[];
 await processScriptJob(j,async input=>{assert.equal(input.disableReasoning,true);const data=JSON.parse(input.prompt);if(data.sceneCount)return JSON.stringify({title:'Two explorers',storyConcept:'Discovery',summary:'Dialogue story',characters:[],scenes:[1,2,3].map(n=>({title:'Scene '+n,purpose:'Discover',duration:7}))});calls.push(data.startOrder);assert.equal(data.requiredSceneKeys.length,1);return JSON.stringify({[data.requiredSceneKeys[0]]:{...scene(data.startOrder),narration:'Provider mistakenly added narration',dialogue:'Explorer: We found the island and can finally explore what lies beyond the distant horizon.'}});});
 const saved=await ScriptJob.findById(j._id);assert.equal(saved.status,'completed');assert.deepEqual(calls,[1,2,3]);const p=await AIProject.findById(saved.projectId);assert.ok(p.scenes.every(s=>s.narration===''&&s.offscreenNarration===false&&s.audioMode==='dialogue'));
});
