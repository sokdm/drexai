import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import argon2 from "argon2";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { env } from "../dist/config/env.js";
import { adminRouter } from "../dist/routes/admin.js";
import { creativeRouter } from "../dist/routes/creative.js";
import { AdminLoginCode } from "../dist/models/Admin.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { CreativeJob } from "../dist/models/CreativeJob.js";
import { VideoEdit } from "../dist/models/VideoEdit.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { prepareShortClips, validateMoments } from "../dist/services/shortClips.js";
import { runMedia, probeMedia, subtitleDocument } from "../dist/services/ffmpeg.js";
let database, server, base, admin, user, directory, captured, headers;
const originalFetch = globalThis.fetch;
before(async () => {
  env.SMTP_HOST = undefined; env.SMTP_USER = undefined; env.SMTP_PASS = undefined;
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
  await mongoose.connect(database.getUri("creative_tests"));
  env.ADMIN_LOGIN_METHOD = "email"; env.RESEND_API_KEY = "test-only-never-a-real-key";
  admin = await User.create({ displayName: "Administrator", email: "admin@example.test", passwordHash: await argon2.hash("SecureExamplePassword123"), role: "admin", status: "active" });
  user = await User.create({ displayName: "Customer", email: "user@example.test", passwordHash: "test", role: "user", status: "active" });
  await Session.create({ userId: user._id, tokenHash: hashSecret("user-session"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  headers = { Cookie: "drex_session=user-session", "x-csrf-token": "csrf" };
  globalThis.fetch = async (url, options) => { if (String(url) === "https://api.resend.com/emails") { captured = JSON.parse(options.body); return new Response(JSON.stringify({ id: "mock-email-accepted" }), { status: 200 }); } return originalFetch(url, options); };
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api/admin", adminRouter); app.use("/api/creative", creativeRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
  directory = await mkdtemp(path.join(tmpdir(), "drex-creative-test-"));
});
after(async () => { globalThis.fetch = originalFetch; server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await database?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function request(endpoint, body, custom = {}) { const response = await fetch(base + endpoint, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...custom }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json(), response }; }
test("administrator password requests an email code, stored hashed, single use and session protected", async () => {
  const credentials = { email: admin.email, password: "SecureExamplePassword123" };
  assert.equal((await request("/api/admin/login", { ...credentials, password: "wrong" })).status, 401);
  const sent = await request("/api/admin/login", credentials); assert.equal(sent.status, 200); assert.ok(sent.data.challengeId); assert.equal(sent.data.user, undefined);
  const code = captured.text.match(/code is (\d{6})/)[1];
  const saved = await AdminLoginCode.findById(sent.data.challengeId); assert.notEqual(saved.codeHash, code); assert.equal(JSON.stringify(sent.data).includes(code), false);
  assert.equal((await request("/api/admin/login", { ...credentials, challengeId: sent.data.challengeId, code: "bad" })).status, 401);
  const login = await request("/api/admin/login", { ...credentials, challengeId: sent.data.challengeId, code }); assert.equal(login.status, 200); assert.equal(login.data.user.email, admin.email); assert.match(login.response.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await request("/api/admin/login", { ...credentials, challengeId: sent.data.challengeId, code })).status, 401);
  assert.equal((await request("/api/admin/me")).status, 401);
});
test("missing mail provider fails closed and never pretends to send a code", async () => {
  env.RESEND_API_KEY = undefined; const response = await request("/api/admin/login", { email: admin.email, password: "SecureExamplePassword123" }); assert.equal(response.status, 503); env.RESEND_API_KEY = "test-only";
});
test("creative jobs are private and require CSRF; unconfigured pricing cannot charge", async () => {
  await CreativeJob.create({ userId: admin._id, kind: "avatar", status: "completed", name: "Private admin video" });
  assert.equal((await request("/api/creative/jobs")).status, 401);
  assert.deepEqual((await request("/api/creative/jobs", null, headers)).data.jobs, []);
  assert.equal((await request("/api/creative/quote", { kind: "shorts", name: "Source", count: 5, sizeBytes: 1000 }, { Cookie: headers.Cookie })).status, 403);
  const quote = await request("/api/creative/quote", { kind: "shorts", name: "Source", count: 5, sizeBytes: 1000 }, headers); assert.equal(quote.status, 200); assert.equal(quote.data.quote.allowed, false);
});
test("removed presenter generation is rejected before quoting or charging", async () => {
 const result = await request("/api/creative/quote", { kind: "avatar", name: "Removed", presenterId: "test", script: "Hello there", ratio: "16:9", consent: true }, headers);
 assert.equal(result.status, 400);
 const config = await request("/api/creative/config", null, headers);
 assert.equal(config.data.presenters, undefined);
 assert.equal(config.data.avatarConfigured, undefined);
});
const moments = { moments: Array.from({ length: 5 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, title: `Moment ${i}`, hook: "A useful idea", score: 65, reason: "A clear self-contained idea", speakerX: .7, captions: [{ start: 0, end: 3, text: "Example speech" }] })) };
test("clip timing rejects overlapping selections, invalid captions and invented out-of-source times", () => {
  assert.equal(validateMoments(moments, 30, 5).moments.length, 5);
  for (const mutate of [m => m.moments[1].start = 0, m => m.moments[0].captions[0].end = 6, m => m.moments[4].end = 60]) { const invalid = structuredClone(moments); mutate(invalid); assert.throws(() => validateMoments(invalid, 30, 5)); }
});
test("real FFmpeg preparation creates five persisted editable clips with original audio and animated captions", { timeout: 180000 }, async () => {
  const source = path.join(directory, "source.mp4");
  await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source]);
  const sourceSize = (await stat(source)).size; const progress = []; const outputs = [];
  const result = await prepareShortClips({ _id: new mongoose.Types.ObjectId(), userId: user._id, sourceKey: "private-source", sizeBytes: sourceSize, name: "Long video", quote: { model: "mock" }, options: { count: 5 } }, async n => progress.push(n), {
    open: async () => ({ ContentLength: sourceSize, Body: createReadStream(source) }), file: async () => ({ name: "files/test", uri: "mock://test" }), removeFile: async () => {}, analyze: async () => moments,
    upload: async (file, key) => { const info = await probeMedia(file); assert.ok(info.audio && info.video); assert.ok(Math.abs(info.duration - 5) < .15); outputs.push(info); return { key, bucket: "test", sizeBytes: (await stat(file)).size }; }
  });
  assert.equal(outputs.length, 5); assert.equal(result.clips.length, 5); assert.equal(progress.at(-1), 95);
  const edits = await VideoEdit.find({ userId: user._id }); assert.equal(edits.length, 5);
  for (const edit of edits) { assert.equal(edit.timeline.aspectRatio, "9:16"); assert.equal(edit.timeline.audio.length, 1); assert.equal(edit.timeline.clips[0].cropX, .7); assert.equal(edit.timeline.captions[0].style.animation, "pop"); assert.match(subtitleDocument(edit.timeline, 720, 1280), /\\t\(0,150/); }
});

test("legacy missing or malformed administrator hashes cannot crash password verification", async () => {
  const { verifyPassword } = await import("../dist/utils/password.js");
  for (const hash of [undefined, null, "", "plain-text", "$argon2id$broken"]) assert.equal(await verifyPassword(hash, "password"), false);
  await User.collection.insertOne({ email: "damaged-admin@example.test", displayName: "Legacy", role: "admin", status: "active", passwordHash: "" });
  const response = await request("/api/admin/login", { email: "damaged-admin@example.test", password: "password" });
  assert.equal(response.status, 401); assert.equal(JSON.stringify(response.data).includes("pchstr"), false);
});

test("full-source transcription extracts every chunk, offsets provider timestamps and records real gateway usage fields", async () => {
 const { transcribeSource } = await import("../dist/services/transcription.js");
 const file = path.join(directory, "full-transcript-source.wav");
 await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=75", file]);
 const previous = globalThis.fetch, priorKey = env.OPENROUTER_API_KEY; let calls = 0;
 env.OPENROUTER_API_KEY = "test-only";
 globalThis.fetch = async (url, options) => {
  if (String(url) === "https://openrouter.ai/api/v1/models") return new Response(JSON.stringify({ data: [{ id: "openai/whisper-large-v3", architecture: { output_modalities: ["transcription"] } }] }));
  if (String(url).endsWith("/audio/transcriptions")) { calls++; const body = JSON.parse(options.body); assert.equal(body.response_format, "verbose_json"); assert.ok(body.input_audio.data.length > 100); return new Response(JSON.stringify({ text: "Actual spoken words", segments: [{ start: 0, end: 1, text: "Actual spoken words" }], usage: { seconds: calls === 1 ? 60 : 15, cost: .001 } }), { headers: { "x-generation-id": `transcript-test-${calls}` } }); }
  return previous(url, options);
 };
 try {
  const progress = [], result = await transcribeSource(file, 75, directory, { allowed: true, feature: "full_video_transcription", model: "openrouter/openai/whisper-large-v3", estimatedCostUsd: .02 }, String(user._id), async n => { progress.push(n); });
  assert.equal(calls, 2); assert.equal(result.segments[1].start, 60); assert.equal(result.segments[1].end, 61); assert.equal(progress.at(-1), 1);
 } finally { globalThis.fetch = previous; env.OPENROUTER_API_KEY = priorKey; }
});
