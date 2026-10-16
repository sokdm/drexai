import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { publishingRouter } from "../dist/routes/publishing.js";
import { imagesRouter } from "../dist/routes/images.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { AIProject } from "../dist/models/AIProject.js";
import { VideoExport } from "../dist/models/VideoEdit.js";
import { PublishingDraft } from "../dist/models/PublishingDraft.js";
import { GenerationPriceRule } from "../dist/models/GenerationPriceRule.js";
import { Wallet } from "../dist/models/Wallet.js";
import { CreditReservation } from "../dist/models/CreditReservation.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { YouTubeConnection } from "../dist/models/YouTubeConnection.js";
import { ImageGenerationJob } from "../dist/models/ImageGenerationJob.js";
import { MediaAsset } from "../dist/models/MediaAsset.js";
import { scheduleSummary } from "../dist/services/publishing.js";
import { encryptSecret } from "../dist/utils/encryption.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { env } from "../dist/config/env.js";
let db, server, base, headers, user, project, exp, draft, png;
const originalFetch = globalThis.fetch, state = { fail: false, generations: 0 };
const metadata = { title: "Original title", description: "Original description", titles: ["An alternative"], keywords: ["original story"], hashtags: ["#Story"], summary: "An original story", thumbnailConcepts: ["An original blue city at dawn"], callsToAction: ["Share your thoughts"], captions: { youtube: "A story", shorts: "A short story", tiktok: "New perspective", facebook: "Explore the story" } };
before(async () => {
  env.GEMINI_API_KEY = "test-only"; env.R2_BUCKET = undefined; env.IMAGE_QUEUE_ENABLED = false;
  png = await sharp({ create: { width: 128, height: 72, channels: 3, background: "#123456" } }).png().toBuffer();
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("drex_phase11"));
  for (const m of [Wallet, CreditReservation, LedgerEntry, PublishingDraft, ImageGenerationJob, MediaAsset]) await m.init();
  user = await User.create({ displayName: "Publisher", email: "phase11@example.test", passwordHash: "test", status: "active" });
  await Session.create({ userId: user._id, tokenHash: hashSecret("phase11-test"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  await Wallet.create({ userId: user._id, availableCredits: 30 });
  await GenerationPriceRule.create({ feature: "publishing_optimization", provider: "gemini", model: "gemini-3.8-flash", unit: "request", creditsPerUnit: 1, active: true });
  project = await AIProject.create({ userId: user._id, title: "Original story", summary: "Original project summary" });
  exp = await VideoExport.create({ userId: user._id, editId: new mongoose.Types.ObjectId(), projectId: project._id, revision: 0, timeline: {}, settings: { filename: "original.mp4" }, status: "completed", width: 1280, height: 720 });
  await AIProject.updateOne({ _id: project._id }, { finalExportId: exp._id });
  headers = { Cookie: "drex_session=phase11-test", "x-csrf-token": "csrf", "Content-Type": "application/json" };
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api/publishing", publishingRouter); app.use("/api/images", imagesRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith(base)) return originalFetch(url, options);
    const u = new URL(String(url));
    if (u.hostname === "generativelanguage.googleapis.com") { state.generations++; if (state.fail) return Response.json({ error: { message: "Provider rejected test request" } }, { status: 400 }); const body = JSON.parse(options.body); return Response.json(body.response_format?.type === "image" ? { output_image: { data: png.toString("base64") } } : { output_text: JSON.stringify(metadata) }); }
    if (u.hostname === "youtubeanalytics.googleapis.com") { assert.equal(options.headers.Authorization, "Bearer test-access"); return Response.json({ columnHeaders: [{ name: "day" }, { name: "views" }], rows: Array.from({ length: 28 }, (_, i) => { const d = new Date(Date.UTC(2026, 8, 1 + i)); return [d.toISOString().slice(0, 10), d.getUTCDay() === 2 ? 700 : 10]; }) }); }
    throw new Error(`Unexpected external request ${u.hostname}`);
  };
});
after(async () => { globalThis.fetch = originalFetch; server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db?.stop(); });
async function request(path, options = {}) { const r = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers } }); return { status: r.status, data: await r.json() }; }
const post = data => ({ method: "POST", body: JSON.stringify(data) });
test("publishing dashboard reuses completed exports and projects; future adapters are manual", async () => {
  const r = await request("/api/publishing/dashboard"); assert.equal(r.status, 200); assert.equal(r.data.exports.length, 1); assert.equal(r.data.projects.length, 1); assert.equal(r.data.platforms.find(p => p.id === "tiktok").mode, "manual"); assert.ok(!JSON.stringify(r.data).includes("leaseToken")); assert.equal((await originalFetch(base + "/api/publishing/dashboard")).status, 401);
});
test("drafts persist edits, reject stale revisions and protect source ownership", async () => {
  const created = await request("/api/publishing/drafts", post({ name: "Launch", brief: "Original story brief", platform: "youtube", projectId: String(project._id), exportId: String(exp._id), metadata })); assert.equal(created.status, 201); draft = created.data.draft;
  const updated = await request(`/api/publishing/drafts/${draft._id}`, { method: "PUT", body: JSON.stringify({ ...draft, metadata: { ...metadata, title: "Reviewed title" } }) }); assert.equal(updated.status, 200); assert.equal(updated.data.draft.revision, 1);
  assert.equal((await request(`/api/publishing/drafts/${draft._id}`)).data.draft.metadata.title, "Reviewed title");
  assert.equal((await request(`/api/publishing/drafts/${draft._id}`, { method: "PUT", body: JSON.stringify(draft) })).status, 409);
  const foreign = await AIProject.create({ userId: new mongoose.Types.ObjectId(), title: "Other user's project" }); assert.equal((await request("/api/publishing/drafts", post({ name: "Wrong", platform: "youtube", metadata, projectId: String(foreign._id) }))).status, 404);
  assert.equal((await request("/api/publishing/drafts", { ...post({ name: "Wrong", platform: "youtube", metadata }), headers: { "x-csrf-token": "wrong" } })).status, 403);
});
test("Gemini optimization requires quoted approval, returns editable metadata and charges once", async () => {
  const input = { brief: "An original city story for general audiences", platform: "youtube", projectId: String(project._id) };
  assert.equal((await request("/api/publishing/optimize", post({ ...input, approvedCredits: 99 }))).status, 400); const before = state.generations;
  const result = await request("/api/publishing/optimize", post({ ...input, approvedCredits: 1 })); assert.equal(result.status, 200); assert.deepEqual(result.data.suggestions, metadata); assert.equal(state.generations, before + 1); assert.equal((await Wallet.findOne({ userId: user._id })).availableCredits, 29);
  assert.equal((await PublishingDraft.findById(draft._id)).metadata.title, "Reviewed title");
});
test("failed Gemini optimization refunds reserved credits", async () => {
  state.fail = true; const before = (await Wallet.findOne({ userId: user._id })).availableCredits;
  const r = await request("/api/publishing/optimize", post({ brief: "An original story with sufficient context", platform: "shorts", approvedCredits: 1 })); assert.equal(r.status, 500); assert.equal((await Wallet.findOne({ userId: user._id })).availableCredits, before); state.fail = false;
});
test("posting guidance labels general data and uses authorized daily analytics with explicit limitations", async () => {
  const general = await request("/api/publishing/recommendations?timezone=Africa%2FLagos"); assert.ok(general.data.items.every(i => i.basis === "General suggestion")); assert.equal((await request("/api/publishing/recommendations?timezone=BadZone")).status, 400);
  assert.equal(scheduleSummary([], []), null);
  await YouTubeConnection.create({ userId: user._id, channelId: "UCmine", scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"], accessTokenEncrypted: encryptSecret("test-access"), expiresAt: new Date(Date.now() + 3600000) });
  const specific = await request("/api/publishing/recommendations?timezone=Africa%2FLagos"); assert.equal(specific.data.items[0].basis, "Limited account data"); assert.match(specific.data.items[0].days, /Tuesday/); assert.match(specific.data.limitation, /not audience-online or hourly data/); assert.equal(specific.data.items[2].basis, "General suggestion");
});
test("thumbnail generation uses existing quote, queue, asset storage and authenticated download", async () => {
  const settings = { prompt: "Original blue city thumbnail", model: "gemini-nano-banana-2.1", aspectRatio: "16:9", resolution: "1K", numberOfImages: 1, characterReferenceIds: [] };
  const quote = await request("/api/images/quote", post(settings)); assert.equal(quote.data.quote.credits, 2);
  assert.equal((await request("/api/images/generate", post({ ...settings, approvedCredits: 1 }))).status, 400);
  const created = await request("/api/images/generate", post({ ...settings, approvedCredits: 2 })); assert.equal(created.status, 202); const jobId = created.data.job._id;
  for (let i = 0; i < 100; i++) { if ((await ImageGenerationJob.findById(jobId)).status === "completed") break; await new Promise(r => setTimeout(r, 50)); }
  assert.equal((await ImageGenerationJob.findById(jobId)).status, "completed");
  const current = await PublishingDraft.findById(draft._id); const linked = await request(`/api/publishing/drafts/${draft._id}`, { method: "PUT", body: JSON.stringify({ ...current.toObject(), thumbnailJobId: jobId }) }); assert.equal(linked.status, 200);
  const result = await request(`/api/publishing/drafts/${draft._id}/thumbnail`); assert.equal(result.data.assets.length, 1); const assetId = result.data.assets[0]._id;
  const download = await fetch(base + `/api/images/assets/${assetId}/download`, { headers }); assert.match(download.headers.get("content-disposition"), /attachment/); assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  assert.equal((await Wallet.findOne({ userId: user._id })).availableCredits, 27);
});
