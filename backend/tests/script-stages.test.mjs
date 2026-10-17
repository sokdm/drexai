import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { processScriptJob, scriptShape } from "../dist/services/scriptProduction.js";
import { ScriptJob } from "../dist/models/ScriptJob.js";
import { AIProject } from "../dist/models/AIProject.js";
import { MediaAsset } from "../dist/models/MediaAsset.js";
import { Wallet } from "../dist/models/Wallet.js";
import { User } from "../dist/models/User.js";
import { reserveCredits } from "../dist/services/wallet.js";
let db,user;
before(async()=>{ db=await MongoMemoryReplSet.create({replSet:{count:1},binary:{downloadDir:fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server",import.meta.url))}});await mongoose.connect(db.getUri("script_stages"));user=await User.create({email:"script-stages@example.test",displayName:"Test",passwordHash:"fixture",status:"active"});await Wallet.create({userId:user._id,availableCredits:1000});});
after(async()=>{await mongoose.disconnect();await db.stop();});
const settings={storyTopic:"An original underwater discovery",type:"Animated story",language:"English",targetDuration:"8 minutes",visualStyle:"Cinematic"};
function scene(order){return{order,title:`Scene ${order}`,sceneDescription:"An original scene",characters:[],narration:Array(70).fill("story").join(" "),dialogue:"",imagePrompt:"Underwater ruins",videoMotionPrompt:"Slow tracking shot",cameraDirection:"Wide angle",estimatedNarrationTiming:"30 seconds",audioSuggestions:"Ocean ambience",transitionSuggestions:"Cut"};}
async function job(extra={}){const quote={credits:9,feature:"story_generation",provider:"fixture",model:"openrouter/fixture/script"};const reservation=await reserveCredits(String(user._id),quote,`fixture:${Math.random()}`);return ScriptJob.create({userId:user._id,requestId:crypto.randomUUID(),status:"processing",reservationId:reservation._id,quote,input:{settings},...extra});}
function mock(failAt=0){let call=0;return async input=>{call++;assert.equal(input.timeoutMs,180000);assert.equal(input.model,"openrouter/fixture/script");if(call===failAt)throw new Error("The operation was aborted due to timeout");if(call===1)return JSON.stringify({title:"The Hidden City",storyConcept:"Discovery",summary:"A complete arc",characters:[],scenes:Array.from({length:16},(_,i)=>({title:`Scene ${i+1}`,purpose:"Develop plot",duration:30}))});const data=JSON.parse(input.prompt);return JSON.stringify({scenes:data.scenes.map((_,i)=>scene(data.startOrder+i))});};}
test("eight-minute generation uses bounded batches and saves a developed script without image calls",async()=>{assert.deepEqual(scriptShape(settings),{seconds:480,scenes:16,calls:9});const j=await job();await processScriptJob(j,mock());const saved=await ScriptJob.findById(j._id);assert.equal(saved.status,"completed");const project=await AIProject.findById(saved.projectId);assert.equal(project.scenes.length,16);assert.equal(project.scenes.reduce((n,s)=>n+s.estimatedDurationSeconds,0),480);assert.equal(await MediaAsset.countDocuments(),0);assert.ok(saved.logs.some(l=>l.stage==="prompts"));});
test("provider timeout preserves completed batches and requires review instead of repeating uncertain paid work",async()=>{const j=await job();await processScriptJob(j,mock(3));const saved=await ScriptJob.findById(j._id);assert.equal(saved.status,"needs_review");assert.equal(saved.cursor,2);assert.equal((await AIProject.findById(saved.resultProjectId)).scenes.length,2);assert.match(saved.error,/timeout/);});
test("safe checkpoint recovery skips completed batches",async()=>{const j=await job();await processScriptJob(j,mock(3));const saved=await ScriptJob.findById(j._id);let calls=0;await processScriptJob(saved,async input=>{calls++;const data=JSON.parse(input.prompt);return JSON.stringify({scenes:data.scenes.map((_,i)=>scene(data.startOrder+i))});});assert.equal(calls,7);assert.equal((await ScriptJob.findById(j._id)).status,"completed");});
test("targeted agent revision changes the real project and preserves other scenes, IDs and a version",async()=>{
 const original=await AIProject.create({userId:user._id,title:"Original title",summary:"Original summary",scenes:Array.from({length:16},(_,i)=>({...scene(i+1),narration:"Keep original words"}))});
 const beforeIds=original.scenes.map(s=>String(s._id));
 const j=await job({input:{settings,projectId:String(original._id),message:"Rewrite Scene 3",snapshot:original.toObject()},baseUpdatedAt:original.updatedAt});
 await processScriptJob(j,mock());const result=await AIProject.findById(original._id);
 assert.equal((await ScriptJob.findById(j._id)).status,"completed");assert.equal(result.scenes[0].narration,"Keep original words");assert.notEqual(result.scenes[2].narration,"Keep original words");assert.deepEqual(result.scenes.map(s=>String(s._id)),beforeIds);assert.equal(result.versions.length,1);assert.equal(result.title,"Original title");
});
