import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import express from "express";
import cookieParser from "cookie-parser";
import sharp from "sharp";
import {videosRouter} from "../dist/routes/videos.js";
import {MediaAsset} from "../dist/models/MediaAsset.js";
import { aiRouter } from "../dist/routes/ai.js";
import { readProviderStream } from "../dist/services/providerStream.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { Wallet } from "../dist/models/Wallet.js";
import { CreditPackage } from "../dist/models/CreditPackage.js";
import { CreditReservation } from "../dist/models/CreditReservation.js";
import { AIConversation } from "../dist/models/AIConversation.js";
import { AIProject } from "../dist/models/AIProject.js";
import { StudioProduction, StudioEvent } from "../dist/models/StudioProduction.js";
import { VideoEdit } from "../dist/models/VideoEdit.js";
import { PricingOverride } from "../dist/models/Finance.js";
import { ProviderControl, ProviderLease } from "../dist/models/Admin.js";
import { withProvider } from "../dist/services/platformControl.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { env } from "../dist/config/env.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
let db, server, base, user; const original = fetch; let providerCalls = 0, plannedTools = [],rejectConfigured=false,rejectSummary=false;
before(async () => {
 db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(db.getUri("research_agent"));
 env.OPENROUTER_API_KEY = "test"; env.OPENROUTER_MANAGEMENT_KEY = undefined;
 user = await User.create({ email: "agent@example.test", displayName: "Agent tester", passwordHash: "test", status: "active" });
 await Session.create({ userId: user._id, tokenHash: hashSecret("agent"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
 await Wallet.create({ userId: user._id, availableCredits: 500 }); await CreditPackage.create({ key: "creator", name: "Creator", active: true, credits: 5000, amount: 90, currency: "USD" });
 await PricingOverride.create({ feature: "ai_research_chat", model: "openrouter/google/gemini-3.8-flash", unit: "request", costUsd: ".001", expiresAt: new Date(Date.now() + 3600000) });
 globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://openrouter.ai")) return original(url, options);
  if (String(url).endsWith("/models")) return Response.json({ data: [{id:"fixture/affordable",architecture:{output_modalities:["text"]},supported_parameters:["max_tokens","response_format"],context_length:64000,pricing:{prompt:"0.00000001",completion:"0.00000004"}}, {id:"openai/gpt-4.1-mini",architecture:{input_modalities:["text","image"],output_modalities:["text"]},supported_parameters:["max_tokens","response_format"],context_length:64000,pricing:{prompt:"0.0000001",completion:"0.0000004"}}, { id: "google/gemini-3.8-flash", architecture: { output_modalities: ["text"] }, supported_parameters: ["max_tokens", "response_format"] }, { id: "fixture/research:free", architecture: { output_modalities: ["text"] }, supported_parameters: ["max_tokens", "response_format"], context_length: 64000, pricing: { prompt: "0", completion: "0" } }] });
  if (String(url).endsWith("/key")) return Response.json({ data: { limit_remaining: 100 } });
  assert.ok(String(url).endsWith("chat/completions")); providerCalls++; const body = JSON.parse(options.body);
  if(rejectConfigured && body.model==="openai/gpt-4.1-mini")return Response.json({error:{message:"No endpoints found that can handle the requested parameters"}},{status:404});
  if (!body.stream) return Response.json({ id: "plan-" + providerCalls, choices: [{ message: { content: JSON.stringify({ tools: plannedTools }) }, finish_reason: "stop" }], usage: { cost: body.model.endsWith(":free") ? 0 : .001 } });
  if(rejectSummary)throw Object.assign(new Error("Fixture summary timeout"),{name:"TimeoutError"});
  return new Response('data: {"id":"answer-1","choices":[{"delta":{"content":"Original idea. "}}]}\n\ndata: {"choices":[{"delta":{"content":"Review your draft."},"finish_reason":"stop"}],"usage":{"cost":0.001}}\n\ndata: [DONE]\n\n');
 };
 const app = express(); app.use(express.json(), cookieParser()); app.use("/api/ai", aiRouter);app.use("/api/videos",videosRouter); app.use(errorHandler); server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); base = `http://127.0.0.1:${server.address().port}/api/ai`;
});
after(async () => { globalThis.fetch = original; server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await db?.stop(); });
beforeEach(async()=>{const {ChatUsage}=await import("../dist/services/chatAccess.js");const {FreeAiUsage}=await import("../dist/services/freeAiLimits.js");await ChatUsage.deleteMany({});await FreeAiUsage.deleteMany({});await Wallet.updateOne({userId:user._id},{$set:{availableCredits:500}});});
const headers = { "Content-Type": "application/json", Cookie: "drex_session=agent", "x-csrf-token": "csrf" };
test("stream parsing emits real chunks and rejects truncated responses", async () => {
 const chunks = []; const result = await readProviderStream(new Response('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'), s => chunks.push(s)); assert.equal(result.text, "Hello"); assert.deepEqual(chunks, ["Hello"]);
 await assert.rejects(() => readProviderStream(new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'), () => {}), /interrupted/);
});
test("nested provider wrappers share one slot while independent requests remain limited", async () => {
 await ProviderControl.create({ provider: "openrouter", model: "openrouter/test", enabled: true, maxConcurrent: 1, maxDailyJobs: 10 });
 await withProvider("openrouter/test", async () => { await withProvider("openrouter/test", async () => assert.equal(await ProviderLease.countDocuments(), 1)); });
 assert.equal(await ProviderLease.countDocuments(), 0); await ProviderControl.deleteMany({});
});
test("agent approval streams a saved response, bills once and protects conversation ownership", async () => {
 const payload = { message: "Suggest an original story", draftProject: false };
 const quoted = await original(base + "/agent/quote", { method: "POST", headers, body: JSON.stringify(payload) }); const { quote } = await quoted.json(); assert.equal(quote.allowed, true); assert.equal(providerCalls, 0);
 const response = await original(base + "/agent/chat", { method: "POST", headers, body: JSON.stringify({ ...payload, approvedCredits: quote.credits }) }); assert.equal(response.status, 200); const wire = await response.text(); assert.match(wire, /event: delta/); assert.match(wire, /event: done/);
 const conversation = await AIConversation.findOne({ userId: user._id }); assert.equal(conversation.messages.length, 2); assert.equal(conversation.messages[1].content, "Original idea. Review your draft."); assert.equal(conversation.activeUntil, undefined); assert.equal(providerCalls, 2); assert.equal(await CreditReservation.countDocuments({ status: "settled" }), 1);
 assert.equal((await original(base + `/agent/conversations/${conversation._id}`)).status, 401);
 const other = await AIConversation.create({ userId: new mongoose.Types.ObjectId(), messages: [] }); assert.equal((await original(base + `/agent/conversations/${other._id}`, { headers })).status, 404);
});

test("Director tools require permission and mutate the same saved editor timeline with real activity logs", async () => {
 const project = await AIProject.create({ userId: user._id, title: "Director test" });
 const production = await StudioProduction.create({ userId: user._id, projectId: project._id, title: "Director test", status: "completed", snapshot: {}, settings: {}, estimate: {}, timeline: [{ sceneId: "scene", durationSeconds: 3 }] });
 const edit = await VideoEdit.create({ userId: user._id, projectId: project._id, productionId: production._id, title: "Director test", timeline: { clips: [{ id: "title", kind: "title", label: "Title", text: "Hello", sourceIn: 0, duration: 3 }], audio: [], captions: [], aspectRatio: "16:9", musicDecision: "none" } });
 plannedTools = [{ name: "edit_timeline", query: "Make cinematic" }];
 try {
  for (const allowTimelineEdits of [false, true]) {
   const payload = { message: "Make this production cinematic", productionId: String(production._id), allowTimelineEdits };
   const quoted = await original(base + "/agent/quote", { method: "POST", headers, body: JSON.stringify(payload) }); const { quote } = await quoted.json();
   const response = await original(base + "/agent/chat", { method: "POST", headers, body: JSON.stringify({ ...payload, approvedCredits: quote.credits }) }); assert.match(await response.text(), /event: done/);
   const saved = await VideoEdit.findById(edit._id); assert.equal(saved.revision, allowTimelineEdits ? 1 : 0);
  }
  assert.equal((await VideoEdit.findById(edit._id)).timeline.clips[0].look, "cinematic");
  assert.ok(await StudioEvent.exists({ productionId: production._id, level: "failure" }));
  assert.ok(await StudioEvent.exists({ productionId: production._id, level: "success" }));
 } finally { plannedTools = []; }
});

test("free research accepts zero-credit approval, executes tools and preserves the wallet",async()=>{
 plannedTools=[];
 const payload={mode:"free",message:"Research a fresh original niche"};
 const quoted=await original(base+"/agent/quote",{method:"POST",headers,body:JSON.stringify(payload)});
 const {quote}=await quoted.json();assert.equal(quote.allowed,true);assert.equal(quote.credits,0);assert.equal(quote.model,"openrouter/fixture/research:free");
 const before=await Wallet.findOne({userId:user._id});
 const response=await original(base+"/agent/chat",{method:"POST",headers,body:JSON.stringify({...payload,approvedCredits:0})});
 assert.equal(response.status,200);assert.match(await response.text(),/event: done/);
 assert.equal((await Wallet.findOne({userId:user._id})).availableCredits,before.availableCredits);
});

test("Director lists licensed packs and applies a permitted preset to the same shared edit",async()=>{
 const {AssetPack}=await import("../dist/routes/assetPacks.js");
 const production=await StudioProduction.findOne({userId:user._id});const existing=await VideoEdit.findOne({productionId:production._id});
 const pack=await AssetPack.create({name:"Warm brand",kind:"effect",license:"Original brand configuration",active:true,preset:{look:"warm"},createdBy:user._id});
 plannedTools=[{name:"list_asset_packs",query:"licensed presets"},{name:"apply_asset_pack",query:String(pack._id)}];
 try {
  const payload={message:"Apply the warm brand preset",productionId:String(production._id),allowTimelineEdits:true};
  const quoted=await original(base+"/agent/quote",{method:"POST",headers,body:JSON.stringify(payload)});const {quote}=await quoted.json();
  const response=await original(base+"/agent/chat",{method:"POST",headers,body:JSON.stringify({...payload,approvedCredits:quote.credits})});assert.match(await response.text(),/event: done/);
  const saved=await VideoEdit.findById(existing._id);assert.equal(saved.timeline.clips[0].look,"warm",JSON.stringify((await AIConversation.findOne({userId:user._id}).sort({createdAt:-1})).messages.at(-1).metadata));assert.equal(saved.revision,existing.revision+1);assert.equal(await VideoEdit.countDocuments({productionId:production._id}),1);
 } finally {plannedTools=[];}
});


test("all chat modes are free even with zero wallet balance and paid provider continuation",async()=>{
 const {PricingPolicy}=await import("../dist/models/Finance.js");await PricingPolicy.updateOne({_id:"global"},{values:{freeUserDailyRequests:1,freeSharedDailyRequests:1,freeSharedMinuteRequests:1}},{upsert:true});
 await Wallet.updateOne({userId:user._id},{$set:{availableCredits:0}});
 try{
 const payload={message:"Hello there",mode:"paid",fastChat:true};const {quote}=await (await original(base+"/agent/quote",{method:"POST",headers,body:JSON.stringify(payload)})).json();assert.equal(quote.credits,0);assert.ok(quote.estimatedCostUsd>0);
 const response=await original(base+"/agent/chat",{method:"POST",headers,body:JSON.stringify({...payload,approvedCredits:0})});assert.match(await response.text(),/event: done/);
 const wallet=await Wallet.findOne({userId:user._id});assert.equal(wallet.availableCredits,0);
 const status=await (await original(base+"/agent/limits",{headers})).json();assert.equal(status.used,1);assert.equal(status.windowHours,4);
 }finally{await PricingPolicy.deleteOne({_id:"global"});}
});
test("chat configuration failures return a safe public message without admin details",async()=>{
 const {ProviderControl}=await import("../dist/models/Admin.js");await ProviderControl.create({provider:"openrouter",model:"openrouter/fixture/research:free",enabled:false});
 const {PricingPolicy}=await import("../dist/models/Finance.js");await PricingPolicy.updateOne({_id:"global"},{values:{chatMaxProviderUsd:0.000000001}},{upsert:true});
 try{const response=await original(base+"/agent/quote",{method:"POST",headers,body:JSON.stringify({message:"Hello",fastChat:true})});const data=await response.json();assert.equal(response.status,503);assert.match(data.error,/temporarily/);assert.doesNotMatch(data.error,/admin|pricing|model|OpenRouter|one-credit/i);}
 finally{await ProviderControl.deleteMany({});await PricingPolicy.deleteOne({_id:"global"});}
});

test("legacy chat ignores old paid approvals and never deducts wallet credits",async()=>{
 const before=await Wallet.findOne({userId:user._id});
 const response=await original(base+"/chat",{method:"POST",headers,body:JSON.stringify({message:"Hello legacy assistant",approvedCredits:1})});
 assert.equal(response.status,200,await response.clone().text());assert.equal((await Wallet.findOne({userId:user._id})).availableCredits,before.availableCredits);
});
test("saved-script assistant revisions require creation credits while messages remain free",async()=>{
 const project=await AIProject.create({userId:user._id,title:"Owned script",scenes:[{order:1,title:"Opening",narration:"Keep original speech",imagePrompt:"A city",videoMotionPrompt:"Slow camera"}]});
 const input={projectId:String(project._id),message:"Rewrite Scene 1",settings:{storyTopic:"An original story",targetDuration:"10 seconds",modelMode:"paid"}};
 const response=await original(base+"/scripts/quote",{method:"POST",headers,body:JSON.stringify(input)});const {quote}=await response.json();assert.equal(response.status,200);assert.ok(quote.credits>=1);
 const before=await Wallet.findOne({userId:user._id});const payload={...input,approvedCredits:quote.credits,requestId:"a716a1f4-1681-4bcb-9372-e9303560fe45"};
 const generated=await original(base+"/scripts/generate",{method:"POST",headers,body:JSON.stringify(payload)});assert.equal(generated.status,202,await generated.clone().text());
 const again=await original(base+"/scripts/generate",{method:"POST",headers,body:JSON.stringify(payload)});assert.equal(again.status,202);
 const status=await (await original(base+"/agent/limits",{headers})).json();assert.equal(status.used,0);assert.equal((await Wallet.findOne({userId:user._id})).availableCredits,before.availableCredits-quote.credits);
});

test("chat quota cannot be bypassed by a new conversation or paid mode",async()=>{
 const {PricingPolicy}=await import("../dist/models/Finance.js");await PricingPolicy.updateOne({_id:"global"},{values:{chatMessagesPerWindow:1}},{upsert:true});
 try{
 const {admitChatMessage}=await import("../dist/services/chatAccess.js");await admitChatMessage(String(user._id));
 for(const mode of ["auto","paid","free","configured"]){const response=await original(base+"/agent/quote",{method:"POST",headers,body:JSON.stringify({message:"Hello",mode})});const data=await response.json();assert.equal(response.status,429);assert.match(data.error,/four-hour/);assert.ok(data.resetsAt);assert.doesNotMatch(data.error,/admin|pricing|OpenRouter/i);}
 }finally{await PricingPolicy.deleteOne({_id:"global"});}
});
test("image motion suggestion costs zero and shares the four-hour allowance",async()=>{
 const png=await sharp({create:{width:24,height:24,channels:3,background:"blue"}}).png().toBuffer();
 const asset=await MediaAsset.create({userId:user._id,type:"image",provider:"upload",storageProvider:"r2",key:"fixture",url:"data:image/png;base64,"+png.toString("base64"),contentType:"image/png",sizeBytes:png.length});
 const url=base.replace("/api/ai","/api/videos/motion-assistant"),body={sourceImageAssetId:String(asset._id)};
 const priced=await original(url,{method:"POST",headers,body:JSON.stringify(body)});const data=await priced.json();assert.equal(priced.status,200,JSON.stringify(data));assert.equal(data.quote.credits,0);
 const before=await Wallet.findOne({userId:user._id});const reply=await original(url,{method:"POST",headers,body:JSON.stringify({...body,approvedCredits:0})});assert.equal(reply.status,200,await reply.clone().text());assert.ok((await reply.json()).prompt);
 assert.equal((await Wallet.findOne({userId:user._id})).availableCredits,before.availableCredits);
 const status=await (await original(base+"/agent/limits",{headers})).json();assert.equal(status.used,1);
});

test("a failed final summary preserves completed tool evidence and does not charge chat",async()=>{
 const production=await StudioProduction.create({userId:user._id,projectId:new mongoose.Types.ObjectId(),title:"Saved production",status:"draft",snapshot:{},settings:{},estimate:{},timeline:[]});
 plannedTools=[{name:"inspect_production",query:"status"}];rejectSummary=true;const before=await Wallet.findOne({userId:user._id});
 try{const response=await original(base+'/agent/chat',{method:'POST',headers,body:JSON.stringify({message:'Inspect production status',productionId:String(production._id),approvedCredits:0})});const wire=await response.text();assert.match(wire,/event: done/);assert.doesNotMatch(wire,/event: error/);assert.match(wire,/tool activity above is saved/);
 const conversation=await AIConversation.findOne({userId:user._id}).sort({createdAt:-1});assert.ok(conversation.messages.some(m=>m.metadata?.toolResult?.tool.name==='inspect_production'));assert.equal(conversation.messages.at(-1).metadata.incomplete,true);assert.equal((await Wallet.findOne({userId:user._id})).availableCredits,before.availableCredits);
 }finally{plannedTools=[];rejectSummary=false;}
});
