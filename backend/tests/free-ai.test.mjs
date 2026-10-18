import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { fileURLToPath } from "node:url";
import { FreeAiUsage, admitFreeAi, verifiedFreeText } from "../dist/services/freeAiLimits.js";
import { PricingPolicy } from "../dist/models/Finance.js";
import { quoteAutomaticCredits } from "../dist/services/creditPricingEngine.js";
import { routerText } from "../dist/services/openrouter.js";
import { env } from "../dist/config/env.js";
let db; const user=String(new mongoose.Types.ObjectId());
before(async()=>{db=await MongoMemoryReplSet.create({replSet:{count:1},binary:{downloadDir:fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server",import.meta.url))}});await mongoose.connect(db.getUri("free_ai"));await FreeAiUsage.init();});
after(async()=>{await mongoose.disconnect();await db.stop();});
test("free classification requires an exact free ID and fully verified zero rates",()=>{
 const r={id:"fixture/model:free",pricing:{prompt:"0",completion:"0"}};
 assert.equal(verifiedFreeText(r),true);
 for(const patch of [{id:"fixture/paid"},{pricing:{}},{pricing:{prompt:"0",completion:"0",request:"0.01"}},{pricing:{prompt:null,completion:"0"}}]) assert.equal(!!verifiedFreeText({...r,...patch}),false);
});
test("atomic shared quotas reject concurrent overflow and roll back all buckets",async()=>{
 await PricingPolicy.create({_id:"global",values:{freeUserDailyRequests:2,freeSharedDailyRequests:3,freeSharedMinuteRequests:3}});
 const now=new Date("2026-10-17T12:00:00Z");
 const results=await Promise.allSettled(Array.from({length:6},()=>admitFreeAi(user,now)));
 assert.equal(results.filter(r=>r.status==="fulfilled").length,2);
 assert.equal(results.filter(r=>r.status==="rejected").length,4);
 assert.equal((await FreeAiUsage.findOne({_id:/day:/})).count,2);
 await admitFreeAi(String(new mongoose.Types.ObjectId()),now);
 await assert.rejects(admitFreeAi(String(new mongoose.Types.ObjectId()),now),/limit reached/);
 assert.equal((await FreeAiUsage.findOne({_id:/day:/})).count,3);
 await admitFreeAi(user,new Date("2026-10-18T12:00:00Z"));
 await assert.rejects(admitFreeAi(),/signed-in/);
});
test("verified free quotes stay zero and execute without a paid fallback",async()=>{
 await FreeAiUsage.deleteMany({});
 const original=globalThis.fetch, key=env.OPENROUTER_API_KEY;env.OPENROUTER_API_KEY="fixture-key";
 const record={id:"fixture/compatible:free",architecture:{output_modalities:["text"]},supported_parameters:["max_tokens","response_format"],context_length:64000,pricing:{prompt:"0",completion:"0",request:"0"}};
 let calls=0;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith("/models"))return Response.json({data:[record,{id:"fixture/paid",architecture:{output_modalities:["text"]},supported_parameters:["max_tokens"],pricing:{prompt:"0.0000001",completion:"0.0000001"}}]});
  assert.equal(String(url),"https://openrouter.ai/api/v1/chat/completions");
  const body=JSON.parse(options.body);assert.equal(body.model,record.id);assert.equal(body.provider.allow_fallbacks,false);calls++;
  return Response.json({id:"free-fixture",choices:[{message:{content:"A real fixture reply"},finish_reason:"stop"}],usage:{cost:0}});
 };
 try {
  const quote=await quoteAutomaticCredits({feature:"ai_research_chat",model:"openrouter/"+record.id,quantity:2});
  assert.equal(quote.credits,0);assert.equal(quote.estimatedCostUsd,0);assert.deepEqual(quote.requestLimits.fallbacks,[]);
  assert.equal(await routerText({model:quote.model,userId:user,system:"Help",prompt:"Research",requestLimits:quote.requestLimits}),"A real fixture reply");
  assert.equal(calls,1);
 } finally {globalThis.fetch=original;env.OPENROUTER_API_KEY=key;}
});

test("automatic routing selects free first and switches at the shared quota without calling a paid provider",async()=>{
 const {assistantModel}=await import("../dist/services/assistantRouting.js");const saved=env.OPENROUTER_API_KEY;env.OPENROUTER_API_KEY="fixture-key";
 try{await FreeAiUsage.deleteMany({});assert.equal(await assistantModel("ai_research_chat","auto",user,2),"openrouter/fixture/compatible:free");await admitFreeAi(user);await admitFreeAi(user);assert.equal(await assistantModel("ai_research_chat","auto",user,2),"openrouter/"+env.OPENROUTER_TEXT_FALLBACK_MODEL);}finally{env.OPENROUTER_API_KEY=saved;}
});

test("a slow free request falls back only within approved terms",async()=>{
 await FreeAiUsage.deleteMany({});const original=globalThis.fetch,key=env.OPENROUTER_API_KEY;env.OPENROUTER_API_KEY="fixture-key";let attempts=[];
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);attempts.push(body.model);if(body.model.endsWith(":free"))throw new DOMException("timed out","TimeoutError");return Response.json({id:"paid-fallback-test",choices:[{message:{content:"Fast reply"},finish_reason:"stop"}],usage:{cost:.0001}});};
 try{assert.equal(await routerText({model:"openrouter/fixture/compatible:free",userId:user,system:"Help",prompt:"Hello",requestLimits:{maxInputTokens:1000,maxOutputTokens:1000,freeDeadlineMs:20,approvedCostUsd:.01,fallbacks:[{model:"openrouter/fixture/paid",maxPrice:{prompt:1,completion:1}}]}}),"Fast reply");assert.deepEqual(attempts,["fixture/compatible:free","fixture/paid"]);}finally{globalThis.fetch=original;env.OPENROUTER_API_KEY=key;}
});
