import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import express from "express";
import cookieParser from "cookie-parser";
import { researchAgentRouter } from "../dist/routes/researchAgent.js";
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
let db, server, base, user; const original = fetch; let providerCalls = 0, plannedTools = [];
before(async () => {
 db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }] }); await mongoose.connect(db.getUri("research_agent"));
 env.OPENROUTER_API_KEY = "test"; env.OPENROUTER_MANAGEMENT_KEY = undefined;
 user = await User.create({ email: "agent@example.test", displayName: "Agent tester", passwordHash: "test", status: "active" });
 await Session.create({ userId: user._id, tokenHash: hashSecret("agent"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
 await Wallet.create({ userId: user._id, availableCredits: 500 }); await CreditPackage.create({ key: "creator", name: "Creator", active: true, credits: 5000, amount: 90, currency: "USD" });
 await PricingOverride.create({ feature: "ai_research_chat", model: "openrouter/google/gemini-3.8-flash", unit: "request", costUsd: ".001", expiresAt: new Date(Date.now() + 3600000) });
 globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://openrouter.ai")) return original(url, options);
  if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "google/gemini-3.8-flash", architecture: { output_modalities: ["text"] }, supported_parameters: ["max_tokens", "response_format"] }] });
  if (String(url).endsWith("/key")) return Response.json({ data: { limit_remaining: 100 } });
  assert.ok(String(url).endsWith("chat/completions")); providerCalls++; const body = JSON.parse(options.body);
  if (!body.stream) return Response.json({ id: "plan-" + providerCalls, choices: [{ message: { content: JSON.stringify({ tools: plannedTools }) }, finish_reason: "stop" }], usage: { cost: .001 } });
  return new Response('data: {"id":"answer-1","choices":[{"delta":{"content":"Original idea. "}}]}\n\ndata: {"choices":[{"delta":{"content":"Review your draft."},"finish_reason":"stop"}],"usage":{"cost":0.001}}\n\ndata: [DONE]\n\n');
 };
 const app = express(); app.use(express.json(), cookieParser()); app.use("/api/ai", researchAgentRouter); app.use(errorHandler); server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); }); base = `http://127.0.0.1:${server.address().port}/api/ai`;
});
after(async () => { globalThis.fetch = original; server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await db?.stop(); });
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
