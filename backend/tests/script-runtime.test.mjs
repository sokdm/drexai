import { scriptSettings } from "../dist/services/scriptProduction.js";
import { rememberQuote } from "../dist/services/managedPricing.js";
import { releaseReservation } from "../dist/services/wallet.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { aiRouter } from "../dist/routes/ai.js";
import { imagesRouter } from "../dist/routes/images.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { Wallet } from "../dist/models/Wallet.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { CreditReservation } from "../dist/models/CreditReservation.js";
import { GenerationPriceRule } from "../dist/models/GenerationPriceRule.js";
import { AIProject } from "../dist/models/AIProject.js";
import { ScriptJob } from "../dist/models/ScriptJob.js";
import { ImageGenerationJob } from "../dist/models/ImageGenerationJob.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { env } from "../dist/config/env.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
let database, server, base, customer, mode = "success";
const originalFetch = globalThis.fetch;
const headers = { "Content-Type": "application/json", Cookie: "drex_session=script-session", "x-csrf-token": "csrf" };
const generated = { title: "An original story", storyConcept: "A discovery", summary: "A city story", characters: [], scenes: [{ order: 1, title: "Discovery", sceneDescription: "A city", characters: [], narration: "The city wakes.", dialogue: "", imagePrompt: "An original illustrated city", videoMotionPrompt: "Slow movement", cameraDirection: "Wide shot", estimatedNarrationTiming: "5 seconds", audioSuggestions: "Soft ambience", transitionSuggestions: "Cut" }] };
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
  await mongoose.connect(database.getUri("drex_script_runtime"));
  for (const m of [Wallet, LedgerEntry, CreditReservation]) await m.init();
  env.GEMINI_API_KEY = "test-only";
  customer = await User.create({ email: "script@example.test", displayName: "Script tester", passwordHash: "test", status: "active", emailVerified: true });
  await Wallet.create({ userId: customer._id, availableCredits: 10, reservedCredits: 0 });
  await Session.create({ userId: customer._id, tokenHash: hashSecret("script-session"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  await GenerationPriceRule.create({ feature: "story_generation", provider: "gemini", model: env.GEMINI_MODEL, unit: "request", creditsPerUnit: 1, active: true });
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
      if (mode === "timeout") throw new DOMException("Timed out", "TimeoutError");
      const payload = JSON.parse(options.body); assert.ok(payload.system_instruction.includes("storyConcept")); assert.ok(options.signal); assert.equal(payload.response_format.schema.properties.characters.items.type, "object");
      return new Response(JSON.stringify({ outputs: [{ type: "text", text: JSON.stringify(mode === "invalid" ? { ...generated, characters: ["Presenter"] } : generated) }] }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api/ai", aiRouter); app.use("/api/images", imagesRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { globalThis.fetch = originalFetch; server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await database?.stop(); });
async function post(path, body) { const response = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }


test("placeholder Redis falls back to a persisted Mongo job without provider execution", async () => {
  env.IMAGE_QUEUE_ENABLED = true; env.REDIS_URL = "REPLACE_WITH_RENDER_INTERNAL_REDIS_URL";
  const settings = { prompt: "An original city", model: "gemini-nano-banana-2.1", aspectRatio: "16:9", resolution: "1K", numberOfImages: 1, characterReferenceIds: [] };
  const quote = await post("/api/images/quote", settings);
  const result = await post("/api/images/generate", { ...settings, approvedCredits: quote.data.quote.credits });
  assert.equal(result.status, 202); const job = await ImageGenerationJob.findOne({ userId: customer._id }); assert.equal(job.dispatchMode, "mongo"); assert.equal(job.status, "queued");
  await releaseReservation(String(job.reservationId), "test_cleanup"); await ImageGenerationJob.deleteOne({ _id: job._id });
  const wallet = await Wallet.findOne({ userId: customer._id }); assert.equal(wallet.availableCredits, 10); assert.equal(wallet.reservedCredits, 0);
});


test("background scripts persist queued requests, deduplicate IDs and enforce ownership", async () => {
 await ScriptJob.init();
 const settings = scriptSettings.parse({ storyTopic: "Recoverable original story", nicheId: "" });
 const quote = { allowed: true, credits: 1, model: "openrouter/fixture/script", provider: "fixture", feature: "story_generation" };
 await rememberQuote(customer._id, { settings }, quote);
 const payload = { background: true, requestId: "d54e1c00-7eb1-42fa-90e6-58e0d973c621", approvedCredits: 1, settings };
 const result = await post("/api/ai/scripts/generate", payload); assert.equal(result.status, 202);
 const again = await post("/api/ai/scripts/generate", payload); assert.equal(again.data.job._id, result.data.job._id);
 const saved = await (await fetch(base + "/api/ai/scripts/jobs/" + result.data.job._id, { headers })).json();
 assert.equal(saved.job.status, "queued"); assert.equal(saved.job.input.settings.storyTopic, settings.storyTopic);
 assert.equal((await Wallet.findOne({ userId: customer._id })).availableCredits, 9);
 assert.equal((await fetch(base + "/api/ai/scripts/jobs/" + result.data.job._id)).status, 401);
 await releaseReservation(String(saved.job.reservationId), "test_cleanup");
});
