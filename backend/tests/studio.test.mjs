import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import express from "express";
import cookieParser from "cookie-parser";
import { buildStudioSteps, studioSettingsSchema, makeTimeline, requiredClips } from "../dist/services/studioPlan.js";
import { runStudioProduction } from "../dist/services/studioExecution.js";
import { settleStudioStep, closeStudioReserve } from "../dist/services/studioBilling.js";
import { reserveCredits } from "../dist/services/wallet.js";
import { CreditPackage } from "../dist/models/CreditPackage.js";
import { fetchVeoDownload } from "../dist/services/videoGeneration.js";
import { wavDuration } from "../dist/services/textToSpeech.js";
import { priceStudioSteps } from "../dist/services/studioPricing.js";
import { StudioProduction, StudioEvent } from "../dist/models/StudioProduction.js";
import { AIProject } from "../dist/models/AIProject.js";
import { Wallet } from "../dist/models/Wallet.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { CreditReservation } from "../dist/models/CreditReservation.js";
import { MediaAsset } from "../dist/models/MediaAsset.js";
import { GenerationPriceRule } from "../dist/models/GenerationPriceRule.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { studioRouter } from "../dist/routes/studio.js";
import { walletRouter } from "../dist/routes/wallet.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { hashSecret } from "../dist/utils/crypto.js";

let database, server, base;
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }] });
  await mongoose.connect(database.getUri("drex_studio_tests"));
  for (const model of [StudioProduction, StudioEvent, AIProject, Wallet, LedgerEntry, CreditReservation, MediaAsset, User, Session]) await model.init();
  const app = express(); app.use(express.json(), cookieParser()); app.use("/studio", studioRouter); app.use("/wallet", walletRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}/studio`;
});
after(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await mongoose.disconnect(); await database?.stop(); });

function wav(seconds) {
  const bytes = seconds * 48000;
  const b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0); b.writeUInt32LE(bytes + 36, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(bytes, 40); return b;
}
function snapshot() {
  return { title: "Two scene test", characters: [{ name: "Guide", appearance: "Green jacket", clothing: "Boots", voicePreference: "Puck" }], scenes: [2, 1].map(order => ({ _id: String(new mongoose.Types.ObjectId()), order, title: `Scene ${order}`, approved: true, imagePrompt: `Original image ${order}`, videoMotionPrompt: `Slow camera ${order}`, narration: `Narration ${order}`, offscreenNarration: true, dialogue: order === 1 ? "Guide: Welcome." : "", characters: ["Guide"] })) };
}
async function fixture(settingsInput = {}, overrides = {}) {
  const userId = new mongoose.Types.ObjectId();
  const source = snapshot(), settings = studioSettingsSchema.parse(settingsInput);
  const project = await AIProject.create({ userId, title: source.title, scenes: source.scenes, approvedAt: new Date() });
  const steps = buildStudioSteps(source, settings).map(s => ({ ...s, credits: 2 }));
  const production = await StudioProduction.create({ userId, projectId: project._id, title: source.title, snapshot: source, settings, steps, estimate: { credits: steps.length * 2, missingPricing: [] }, status: "queued", control: "run", maxCredits: 100, approvedAt: new Date() });
  await Wallet.create({ userId, availableCredits: 1000 });
  const reservation = await reserveCredits(String(userId), { credits: 100 }, `test-budget:${production._id}`);
  production.reservationId = reservation._id; await production.save();
  const objects = new Map(), calls = { image: [], speech: [], video: [], poll: [] };
  const upload = async (buffer, key, contentType) => { objects.set(key, { buffer, contentType, bucket: "test" }); return { key, bucket: "test", url: "", storageProvider: "r2" }; };
  const providers = {
    image: async input => { calls.image.push(input); return [{ buffer: Buffer.from("image fixture"), contentType: "image/png" }]; },
    speech: async input => { calls.speech.push(input); const buffer = wav(input.text === "Narration 1" ? 20 : input.text === "Welcome." ? 4 : 12); return { buffer, durationSeconds: wavDuration(buffer), contentType: "audio/wav", providerData: { usage: { test: true } } }; },
    createVideo: async input => { calls.video.push(input); assert.ok(input.sourceImageBytes); return `operations/test-${calls.video.length}`; },
    pollVideo: async name => { calls.poll.push(name); return { name, done: true }; },
    downloadVideo: async () => [{ buffer: Buffer.from("video fixture"), contentType: "video/mp4", metadata: { nativeAudio: true, durationSeconds: 8, audioReview: { status: "needs_review", audioTrackDetected: true } } }],
    read: async key => objects.get(key) ?? null,
    uploadImage: upload, uploadAudio: upload, uploadVideo: upload, ...overrides
  };
  return { production, reservation, userId, project, providers, calls, objects, upload };
}

test("measures actual WAV data and rejects malformed audio", () => {
  assert.equal(wavDuration(wav(24)), 24);
  assert.throws(() => wavDuration(Buffer.from("not audio")));
  assert.throws(() => wavDuration(wav(1).subarray(0, 50)));
});
test("planning preserves chronology, character context, voices, and duration caps", () => {
  const settings = studioSettingsSchema.parse({ maxClipsPerScene: 3 });
  const steps = buildStudioSteps(snapshot(), settings);
  assert.deepEqual(steps.filter(s => s.kind === "image").map(s => s.sceneOrder), [1, 2]);
  assert.match(steps[0].input.prompt, /Green jacket/);
  assert.equal(steps.find(s => s.input.speaker === "Narrator").input.voiceId, "Kore");
  assert.ok(!steps.some(s => s.kind === "audio" && s.input.track === "dialogue"));
  assert.equal(steps.find(s => s.kind === "video" && s.sceneOrder === 1).input.dialogueLines[0].speaker, "Guide");
  assert.equal(requiredClips(24, settings), 3);
  assert.equal(requiredClips(60, settings), 3);
  const invalid = snapshot(); invalid.scenes[0].approved = false;
  assert.throws(() => buildStudioSteps(invalid, settings), /approval/);
});
test("missing pricing blocks billing and configured rules drive quotes", async () => {
  await CreditPackage.create({ key: "test-creator", name: "Test only", credits: 5000, amount: 50, currency: "USD", active: true });
  const steps = buildStudioSteps(snapshot(), studioSettingsSchema.parse({ video: false, narration: false }));
  let quote = await priceStudioSteps(steps);
  assert.equal(quote.credits, null);
  await GenerationPriceRule.create({ feature: "text_to_image", provider: "gemini", model: steps[0].input.model, unit: "image:1K", creditsPerUnit: 3, providerCostUsd: 0.01, active: true });
  quote = await priceStudioSteps(steps); assert.equal(quote.credits, 6);
  const expensive = buildStudioSteps(snapshot(), studioSettingsSchema.parse({ video: false, narration: false, resolution: "2K" }));
  await GenerationPriceRule.create({ feature: "text_to_image", provider: "gemini", model: steps[0].input.model, unit: "image:2K", creditsPerUnit: 10, providerCostUsd: 0.04, active: true });
  assert.equal((await priceStudioSteps(expensive)).credits, 20);
  await GenerationPriceRule.updateOne({ unit: "image:2K" }, { creditsPerUnit: 1 });
  await assert.rejects(priceStudioSteps(expensive), /cheapest credit package/);
});

test("video downloads follow trusted redirects without forwarding credentials", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/test/clip.mp4" } }) : new Response("video");
  };
  assert.equal((await fetchVeoDownload("https://generativelanguage.googleapis.com/download/test", request)).status, 200);
  assert.equal(calls[1].options.headers["x-goog-api-key"], undefined);
  await assert.rejects(fetchVeoDownload("http://127.0.0.1/private", request), /Unexpected/);
  await assert.rejects(fetchVeoDownload("https://generativelanguage.googleapis.com/download/test", async () => new Response(null, { status: 302, headers: { location: "https://untrusted.example/file" } })), /Unexpected/);
});
test("multi-scene production stores correct assets, releases unused credits, and creates a rough cut", async () => {
  const f = await fixture();
  await runStudioProduction(String(f.production._id), f.providers);
  const p = await StudioProduction.findById(f.production._id);
  assert.equal(p.status, "completed"); assert.deepEqual(p.timeline.map(s => s.order), [1, 2]);
  assert.deepEqual(p.timeline.map(s => s.durationSeconds), [20, 12]);
  assert.deepEqual(p.timeline.map(s => s.clips.length), [1, 2]);
  assert.equal(p.timeline[1].startSeconds, 20);
  assert.equal(p.timeline[1].clips[1].durationSeconds, 4);
  const assets = await MediaAsset.find({ productionId: p._id });
  for (const step of p.steps.filter(s => s.assetId)) assert.equal(assets.find(a => String(a._id) === step.assetId).sceneId, step.sceneId);
  const w = await Wallet.findOne({ userId: f.userId });
  assert.equal(w.reservedCredits, 0); assert.equal(w.spentCredits, 14); assert.equal(w.availableCredits, 986);
  assert.equal((await AIProject.findById(f.project._id)).productionTimeline.length, 2);
  assert.ok(await StudioEvent.exists({ productionId: p._id, message: "Your video production is ready for review." }));
  await runStudioProduction(String(p._id), f.providers); assert.equal(f.calls.image.length, 2);
});
test("duplicate and concurrent workers cannot generate or settle twice", async () => {
  const f = await fixture({ video: false, narration: false });
  await Promise.all([runStudioProduction(String(f.production._id), f.providers), runStudioProduction(String(f.production._id), f.providers)]);
  assert.equal(f.calls.image.length, 2);
  assert.equal((await Wallet.findOne({ userId: f.userId })).spentCredits, 4);
});
test("retry preserves earlier outputs after a definite provider rejection", async () => {
  const f = await fixture({ video: false, narration: false });
  const original = f.providers.image; let rejected = false;
  f.providers.image = async input => { if (input.prompt.startsWith("Original image 2") && !rejected) { rejected = true; throw Object.assign(new Error("Provider rejected request"), { providerRejected: true }); } return original(input); };
  await runStudioProduction(String(f.production._id), f.providers);
  let p = await StudioProduction.findById(f.production._id); assert.equal(p.status, "failed"); assert.equal(p.steps[0].status, "completed");
  p.steps = p.steps.map(s => s.status === "failed" ? { ...s, status: "pending" } : s); p.status = "queued"; await p.save();
  await runStudioProduction(String(p._id), f.providers);
  assert.equal(f.calls.image.length, 2); assert.equal((await StudioProduction.findById(p._id)).status, "completed");
});
test("uncertain provider requests are not silently resubmitted", async () => {
  let calls = 0;
  const f = await fixture({ video: false, narration: false }, { image: async () => { calls++; throw new Error("Request timeout"); } });
  await runStudioProduction(String(f.production._id), f.providers);
  let p = await StudioProduction.findById(f.production._id); assert.equal(p.status, "needs_review");
  p.status = "queued"; p.steps[0].status = "requesting"; p.markModified("steps"); await p.save();
  await runStudioProduction(String(p._id), f.providers);
  assert.equal(calls, 1); assert.equal((await Wallet.findOne({ userId: f.userId })).spentCredits, 0);
});

test("video retry replaces a rejected operation but resumes a delayed one", async () => {
  const f = await fixture({ narration: false, targetSeconds: 8, maxClipsPerScene: 1 });
  const poll = f.providers.pollVideo;
  let rejected = false;
  f.providers.pollVideo = async name => {
    if (!rejected) { rejected = true; throw Object.assign(new Error("Definite provider failure"), { providerRejected: true }); }
    return poll(name);
  };
  await runStudioProduction(String(f.production._id), f.providers);
  let p = await StudioProduction.findById(f.production._id);
  const failed = p.steps.find(s => s.status === "failed");
  assert.ok(!failed.providerJobId); assert.equal(failed.failedProviderJobIds.length, 1);
  p.steps = p.steps.map(s => s.status === "failed" ? { ...s, status: "pending" } : s); p.status = "queued"; await p.save();
  let delayed = false;
  f.providers.pollVideo = async name => { if (!delayed) { delayed = true; throw new Error("Temporary polling timeout"); } return poll(name); };
  await runStudioProduction(String(p._id), f.providers);
  p = await StudioProduction.findById(p._id);
  assert.ok(p.steps.find(s => s.status === "failed").providerJobId);
  const submissions = f.calls.video.length;
  p.steps = p.steps.map(s => s.status === "failed" ? { ...s, status: "pending" } : s); p.status = "queued"; await p.save();
  await runStudioProduction(String(p._id), f.providers);
  assert.equal(f.calls.video.length, submissions + 1); // Only the second scene is a new submission.
  assert.equal((await StudioProduction.findById(p._id)).status, "completed");
  assert.equal((await Wallet.findOne({ userId: f.userId })).spentCredits, 8);
});
test("restart recovers a stored output without generating it again", async () => {
  const f = await fixture({ video: false, narration: false });
  let failed = false;
  f.providers.uploadImage = async (...args) => { const stored = await f.upload(...args); if (!failed) { failed = true; throw new Error("Simulated interruption after upload"); } return stored; };
  await runStudioProduction(String(f.production._id), f.providers);
  const p = await StudioProduction.findById(f.production._id); p.status = "queued"; p.steps[0].status = "requesting"; p.markModified("steps"); await p.save();
  await runStudioProduction(String(p._id), f.providers);
  assert.equal(f.calls.image.length, 2); assert.equal((await StudioProduction.findById(p._id)).status, "completed");
});
test("pause stops new work and cancellation releases only unused reserve", async () => {
  const f = await fixture({ video: false, narration: false });
  const original = f.providers.image;
  f.providers.image = async input => { await StudioProduction.updateOne({ _id: f.production._id }, { control: "pause" }); return original(input); };
  await runStudioProduction(String(f.production._id), f.providers);
  let p = await StudioProduction.findById(f.production._id); assert.equal(p.status, "paused"); assert.equal(f.calls.image.length, 1);
  p.status = "queued"; p.control = "cancel"; await p.save();
  await runStudioProduction(String(p._id), f.providers);
  const w = await Wallet.findOne({ userId: f.userId }); assert.equal(w.spentCredits, 2); assert.equal(w.reservedCredits, 0); assert.equal(w.availableCredits, 998);
});
test("wallet settlement is idempotent, enforces the cap, and rejects insufficient credits", async () => {
  const f = await fixture({ video: false, narration: false });
  await Promise.all(Array.from({ length: 3 }, () => settleStudioStep(String(f.reservation._id), "same-output", 7)));
  assert.equal((await Wallet.findOne({ userId: f.userId })).spentCredits, 7);
  await assert.rejects(settleStudioStep(String(f.reservation._id), "overspend", 94), /spending limit/);
  await assert.rejects(reserveCredits(String(f.userId), { credits: 2000 }, "insufficient-test"), /Insufficient/);
  await closeStudioReserve(String(f.reservation._id), "test cancelled");
  await closeStudioReserve(String(f.reservation._id), "duplicate cancellation");
  assert.equal((await Wallet.findOne({ userId: f.userId })).availableCredits, 993);
});

test("approval rollback does not strand credits and cancellation requires CSRF", async () => {
  const f = await fixture({ video: false, narration: false });
  const session = await mongoose.startSession();
  try {
    await assert.rejects(session.withTransaction(async () => {
      await reserveCredits(String(f.userId), { credits: 50 }, "rolled-back-budget", session);
      throw new Error("Simulated approval interruption");
    }), /interruption/);
  } finally { await session.endSession(); }
  assert.equal(await CreditReservation.countDocuments({ idempotencyKey: "rolled-back-budget" }), 0);
  assert.equal((await Wallet.findOne({ userId: f.userId })).availableCredits, 900);
  await User.create({ _id: f.userId, displayName: "Cancellation test", email: `cancel-${f.userId}@example.test`, passwordHash: "test-only", status: "active" });
  const token = `cancel-${f.userId}`;
  await Session.create({ userId: f.userId, tokenHash: hashSecret(token), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 60000) });
  const headers = { Cookie: `drex_session=${token}; drex_csrf=csrf`, "Content-Type": "application/json" };
  const request = { method: "POST", headers, body: JSON.stringify({ action: "cancel" }) };
  assert.equal((await fetch(`${base}/productions/${f.production._id}/control`, request)).status, 403);
  request.headers["x-csrf-token"] = "csrf";
  for (const endpoint of ["/reservations", `/reservations/${f.reservation._id}/settle`, `/reservations/${f.reservation._id}/release`]) {
    assert.equal((await fetch(base.replace("/studio", "/wallet") + endpoint, request)).status, 403);
  }
  assert.equal((await Wallet.findOne({ userId: f.userId })).reservedCredits, 100);
  for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/productions/${f.production._id}/control`, request)).status, 200);
  assert.equal((await StudioProduction.findById(f.production._id)).status, "cancelled");
  assert.equal((await Wallet.findOne({ userId: f.userId })).availableCredits, 1000);
  assert.equal((await Wallet.findOne({ userId: f.userId })).reservedCredits, 0);
});
test("API requires authentication, blocks foreign productions, and can replay persisted events", async () => {
  const f = await fixture({ video: false, narration: false });
  const user = await User.create({ displayName: "Test owner", email: `test-${f.userId}@example.test`, passwordHash: "test-only", status: "active" });
  const token = `session-${user._id}`;
  await Session.create({ userId: user._id, tokenHash: hashSecret(token), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 60000) });
  const headers = { Cookie: `drex_session=${token}` };
  assert.equal((await fetch(`${base}/productions/${f.production._id}`)).status, 401);
  assert.equal((await fetch(`${base}/productions/${f.production._id}`, { headers })).status, 404);
  await StudioProduction.updateOne({ _id: f.production._id }, { userId: user._id });
  const e = await StudioEvent.create({ productionId: f.production._id, userId: user._id, level: "success", message: "Saved real event" });
  const first = await fetch(`${base}/productions/${f.production._id}`, { headers }); assert.equal(first.status, 200);
  assert.equal((await first.json()).events[0].message, "Saved real event");
  const controller = new AbortController();
  const stream = await fetch(`${base}/productions/${f.production._id}/events`, { headers, signal: controller.signal });
  const chunk = await stream.body.getReader().read();
  assert.match(new TextDecoder().decode(chunk.value), new RegExp(String(e._id))); controller.abort();
  const again = await fetch(`${base}/productions/${f.production._id}`, { headers }); assert.equal((await again.json()).events[0].message, "Saved real event");
});

test("incomplete native audio requires review and never automatically charges or regenerates", async () => {
 const f = await fixture({ narration: false, targetSeconds: 8, maxClipsPerScene: 1 }, { downloadVideo: async () => [{ buffer: Buffer.from("missing soundtrack"), contentType: "video/mp4", metadata: {} }] });
 await runStudioProduction(String(f.production._id), f.providers);
 const production = await StudioProduction.findById(f.production._id);
 assert.equal(production.status, "needs_review"); assert.match(production.error, /incomplete/);
 const failed = production.steps.find(s => s.kind === "video" && s.status === "needs_review"); assert.ok(failed); assert.equal(failed.charged, undefined);
 const calls = f.calls.video.length; await runStudioProduction(String(production._id), f.providers); assert.equal(f.calls.video.length, calls);
 assert.ok(!f.calls.speech.length); assert.equal((await Wallet.findOne({ userId: f.userId })).spentCredits, 4);
});
