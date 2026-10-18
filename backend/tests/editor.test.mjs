import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { timelineSchema, splitTimeline, deleteClips, trackStart, timelineDuration } from "@drex/shared";

Object.assign(process.env, { NODE_ENV: "test", RENDER_QUEUE_ENABLED: "true", R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test-secret", R2_BUCKET: "private-test", R2_PUBLIC_BASE_URL: "" });
const objects = new Map(), storageRequests = [];
const store = createServer(async (req, res) => {
  const key = decodeURIComponent(new URL(req.url, "http://localhost").pathname).split("/").slice(2).join("/"); storageRequests.push(`${req.method} ${key}`);
  if (req.method === "PUT") { const chunks = []; for await (const chunk of req) chunks.push(chunk); objects.set(key, Buffer.concat(chunks)); res.writeHead(200, { ETag: '"test-etag"' }); res.end(); return; }
  const bytes = objects.get(key); if (!bytes) { res.writeHead(404, { "content-type": "application/xml" }); res.end("<Error><Code>NoSuchKey</Code></Error>"); return; }
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/), start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
  res.writeHead(range ? 206 : 200, { "content-type": key.endsWith(".mp4") ? "video/mp4" : "application/octet-stream", "content-length": end - start + 1, "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
  res.end(req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
});
await new Promise(resolve => store.listen(0, "127.0.0.1", resolve)); process.env.R2_TEST_ENDPOINT = `http://127.0.0.1:${store.address().port}`;
const { editorRouter } = await import("../dist/routes/editor.js");
const { User } = await import("../dist/models/User.js");
const { Session } = await import("../dist/models/Session.js");
const { MediaAsset } = await import("../dist/models/MediaAsset.js");
const { AIProject } = await import("../dist/models/AIProject.js");
const { StudioProduction } = await import("../dist/models/StudioProduction.js");
const { VideoEdit, VideoExport, RenderWorker } = await import("../dist/models/VideoEdit.js");
const { hashSecret } = await import("../dist/utils/crypto.js");
const { errorHandler } = await import("../dist/middleware/errorHandler.js");
const { runMedia, probeMedia, renderCapabilities, subtitleDocument, renderTimeline } = await import("../dist/services/ffmpeg.js");
const { processVideoExport } = await import("../dist/services/videoExport.js");
const { editorAssetBytes } = await import("../dist/services/videoEditing.js");
const { env } = await import("../dist/config/env.js");
const directory = await mkdtemp(path.join(tmpdir(), "drex-editor-test-"));
const artifacts = fileURLToPath(new URL("../test-artifacts/", import.meta.url));
let db, server, base, headers, user, project, production, edit, narration, spokenNarration, musicAsset, worker, workerLog = "", exported;
const originalConsoleError = console.error;
async function request(route, options = {}) { const response = await fetch(base + route, { ...options, headers: { ...headers, ...options.headers } }); const data = await response.json(); return { response, data }; }
const json = body => ({ method: "POST", body: JSON.stringify(body) });
async function waitFor(fn, timeout = 120000) { const end = Date.now() + timeout; while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 300)); } throw new Error(`Timed out. Worker: ${workerLog}`); }
before(async () => {
  console.error = (...args) => { if (!args[0]?.statusCode && args[0]?.name !== "ZodError") originalConsoleError(...args); };
  db = await MongoMemoryReplSet.create({ instanceOpts: [{ launchTimeout: 60000 }], binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri("drex_phase10_tests"));
  user = await User.create({ displayName: "Editor test", email: "editor@example.test", passwordHash: "test-only", status: "active" });
  await Session.create({ userId: user._id, tokenHash: hashSecret("editor-test"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  headers = { Cookie: "drex_session=editor-test", "x-csrf-token": "csrf", "Content-Type": "application/json" };
  const app = express(); app.use(express.json({ limit: "2mb" }), cookieParser()); app.use("/api/editor", editorRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}/api/editor`;
  project = await AIProject.create({ userId: user._id, title: "Phase 10 original render test" });
  const common = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2"];
  for (const [name, color] of [["first", "0x174d59"], ["second", "0x533568"]]) await runMedia("ffmpeg", [...common, "-f", "lavfi", "-i", `color=c=${color}:s=854x480:r=30:d=2`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(directory, `${name}.mp4`)]);
  await writeFile(path.join(directory, "still.png"), await sharp({ create: { width: 854, height: 480, channels: 3, background: "#1d5c40" } }).png().toBuffer());
  await runMedia("ffmpeg", [...common, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-c:a", "pcm_s16le", path.join(directory, "narration.wav")]);
  await runMedia("ffmpeg", [...common, "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=8", "-c:a", "pcm_s16le", path.join(directory, "music.wav")]);
  await copyFile(fileURLToPath(new URL("./fixtures/original-narration.wav", import.meta.url)), path.join(directory, "spoken.wav"));
  async function asset(name, type, extra = {}) { const bytes = await readFile(path.join(directory, name)); const key = `${user._id}/fixtures/${name}`; objects.set(key, bytes); const info = await probeMedia(path.join(directory, name)); return MediaAsset.create({ userId: user._id, projectId: project._id, provider: "upload", type, storageProvider: "r2", bucket: "private-test", key, contentType: type === "audio" ? "audio/wav" : type === "image" ? "image/png" : "video/mp4", sizeBytes: bytes.length, width: info.width, height: info.height, durationSeconds: info.duration, ...extra }); }
  const first = await asset("first.mp4", "video"), second = await asset("second.mp4", "video"), image = await asset("still.png", "image");
  narration = await asset("narration.wav", "audio", { prompt: "An original scene begins here.", metadata: { transcript: "An original scene begins here." } });
  spokenNarration = await asset("spoken.wav", "audio", { prompt: "The original story ends.", metadata: { transcript: "The original story ends.", name: "Original spoken narration" } });
  musicAsset = await asset("music.wav", "audio", { metadata: { name: "Original synthetic test tone", licenseConfirmed: true, audioRole: "music" } });
  production = await StudioProduction.create({ userId: user._id, projectId: project._id, title: project.title, status: "completed", snapshot: { scenes: [] }, settings: { aspectRatio: "16:9" }, estimate: {}, timeline: [
    { sceneId: "s1", title: "First scene", durationSeconds: 2, startSeconds: 0, clips: [{ assetId: String(first._id), durationSeconds: 2 }], audio: [{ assetId: String(narration._id), startSeconds: 0.25, durationSeconds: 1, track: "narration", speaker: "Narrator" }] },
    { sceneId: "s2", title: "Second scene", durationSeconds: 2, startSeconds: 2, clips: [{ assetId: String(second._id), durationSeconds: 2 }], audio: [{ assetId: String(narration._id), startSeconds: 0.4, durationSeconds: 1, track: "dialogue", speaker: "Character" }] },
    { sceneId: "s3", title: "Still image scene", durationSeconds: 1, startSeconds: 4, clips: [], imageAssetId: String(image._id), audio: [] },
  ] });
  await mkdir(artifacts, { recursive: true });
});
after(async () => {
  console.error = originalConsoleError;
  if (worker && worker.exitCode === null) { worker.kill(); await Promise.race([new Promise(resolve => worker.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))]); }
  server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); store.closeAllConnections(); await new Promise(resolve => store.close(resolve));
  await mongoose.disconnect(); await db?.stop();
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("drex-editor-test-")) throw new Error("Unexpected cleanup path");
  await rm(directory, { recursive: true, force: true });
});

test("FFmpeg supports the codecs, filters and subtitle renderer", async () => { assert.equal((await renderCapabilities()).captions, true); });
test("ownership, CSRF, rough-cut import and idempotent resume", async () => {
  assert.equal((await fetch(base + "/config")).status, 401);
  assert.equal((await fetch(base + "/edits", { ...json({ productionId: String(production._id) }), headers: { Cookie: headers.Cookie, "Content-Type": "application/json" } })).status, 403);
  const created = await request("/edits", json({ productionId: String(production._id) })); assert.equal(created.response.status, 201); edit = created.data.edit;
  assert.equal(edit.timeline.clips.length, 3); assert.equal(edit.timeline.audio.length, 2); assert.equal(timelineDuration(edit.timeline), 5);
  assert.equal((await request("/edits", json({ productionId: String(production._id) }))).data.edit._id, edit._id);
  assert.equal((await request(`/edits/${new mongoose.Types.ObjectId()}`)).response.status, 404);
  const foreign = await MediaAsset.create({ ...narration.toObject(), _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId() });
  const timeline = structuredClone(edit.timeline); timeline.audio[0].assetId = String(foreign._id);
  assert.equal((await request(`/edits/${edit._id}`, { method: "PUT", body: JSON.stringify({ revision: 0, title: edit.title, timeline }) })).response.status, 404);
});
test("split, reorder, scene delete and audio anchors preserve real timeline timing", () => {
  const original = structuredClone(edit.timeline), split = splitTimeline(original, original.clips[0].id, 0.8, "split");
  assert.equal(split.clips.length, 4); assert.equal(split.clips[1].sourceIn, 0.8); assert.equal(timelineDuration(split), 5);
  const reordered = { ...split, clips: [split.clips[2], ...split.clips.slice(0, 2), split.clips[3]] };
  assert.equal(trackStart(reordered, reordered.audio[0]), 2.25);
  const deleted = deleteClips(original, original.clips.filter(c => c.sceneId === "s1").map(c => c.id)); assert.equal(deleted.clips.length, 2); assert.equal(deleted.audio.length, 1); assert.equal(trackStart(deleted, deleted.audio[0]), 0.4);
  assert.throws(() => timelineSchema.parse({ ...original, audio: [{ ...original.audio[0], anchorClipId: "missing" }] }));
});
test("music uploads validate audio contents and usage permission", async () => {
  const bytes = await readFile(path.join(directory, "music.wav"));
  const opts = { method: "POST", headers: { "Content-Type": "audio/wav", "x-file-name": "Original%20test.wav", "x-license-confirmed": "false" }, body: bytes };
  assert.equal((await request(`/edits/${edit._id}/audio?role=music`, opts)).response.status, 400);
  const uploaded = await request(`/edits/${edit._id}/audio?role=music`, { ...opts, headers: { ...opts.headers, "x-license-confirmed": "true" } });
  assert.equal(uploaded.response.status, 201); assert.equal(uploaded.data.asset.metadata.licenseConfirmed, true); musicAsset = await MediaAsset.findById(uploaded.data.asset._id);
  const bad = await request(`/edits/${edit._id}/audio?role=sfx`, { ...opts, body: Buffer.from("not audio") }); assert.equal(bad.response.status, 400);
});
test("save validates trim bounds and prevents stale overwrites; captions use measured speech", async () => {
  const invalid = structuredClone(edit.timeline); invalid.clips[0].duration = 10;
  assert.equal((await request(`/edits/${edit._id}`, { method: "PUT", body: JSON.stringify({ revision: 0, title: edit.title, timeline: invalid }) })).response.status, 400);
  const timeline = structuredClone(edit.timeline);
  timeline.clips[0].transition = "fade"; timeline.clips[2].duration = 1.5;
  const captions = await request(`/edits/${edit._id}/captions`, json({ timeline })); assert.equal(captions.response.status, 200); assert.equal(captions.data.captions.length, 2); timeline.captions = captions.data.captions;
  const intro = { id: "intro", kind: "title", label: "Intro", duration: 0.5, sourceIn: 0, transition: "cut", fit: "contain", text: "Original story", textStyle: { font: "Georgia", size: 48, position: "center", preset: "clean" } };
  timeline.clips.unshift(intro); timeline.clips.push({ ...intro, id: "outro", label: "Outro", text: "The end" });
  timeline.audio.push({ id: "music", assetId: String(musicAsset._id), label: "Original licensed test music", role: "music", start: 0, sourceIn: 0, duration: 6.5, volume: 0.15, muted: false, fadeIn: 0.2, fadeOut: 0.4 }); timeline.musicDecision = "added";
  timeline.audio.push({ id: "spoken", assetId: String(spokenNarration._id), label: "Original spoken narration", role: "narration", start: 6.5 - spokenNarration.durationSeconds, sourceIn: 0, duration: spokenNarration.durationSeconds, volume: 0.8, muted: false, fadeIn: 0, fadeOut: 0 });
  timeline.captions = (await request(`/edits/${edit._id}/captions`, json({ timeline }))).data.captions;
  const result = await request(`/edits/${edit._id}`, { method: "PUT", body: JSON.stringify({ revision: 0, title: edit.title, timeline }) }); assert.equal(result.response.status, 200); edit = result.data.edit;
  assert.equal(edit.revision, 1); assert.equal(timelineDuration(edit.timeline), 6.5);
  assert.equal((await request(`/edits/${edit._id}`, { method: "PUT", body: JSON.stringify({ revision: 0, title: edit.title, timeline }) })).response.status, 409);
  const restored = (await request(`/edits/${edit._id}`)).data.edit; assert.deepEqual(restored.timeline, edit.timeline);
  assert.match(subtitleDocument(edit.timeline, 854, 480), /Original story/);
});
test("exports reject unavailable infrastructure, unsupported resolution and unsafe filenames", async () => {
  const settings = { format: "mp4", resolution: "480p", quality: "standard", filename: "phase10-final" };
  assert.equal((await request(`/edits/${edit._id}/exports`, json({ revision: 1, settings }))).response.status, 503);
  await RenderWorker.create({ _id: "ffmpeg", expiresAt: new Date(Date.now() + 60000), capabilities: await renderCapabilities() });
  assert.equal((await request(`/edits/${edit._id}/exports`, json({ revision: 1, settings: { ...settings, resolution: "1080p" } }))).response.status, 400);
  assert.equal((await request(`/edits/${edit._id}/exports`, json({ revision: 1, settings: { ...settings, filename: "../../bad;command" } }))).response.status, 400);
  assert.equal((await request(`/edits/${edit._id}/exports`, json({ revision: 0, settings }))).response.status, 409);
});
test("dedicated worker renders, verifies R2 protocol storage, downloads and saves a complete MP4", { timeout: 180000 }, async () => {
  const queued = await request(`/edits/${edit._id}/exports`, json({ revision: edit.revision, settings: { format: "mp4", resolution: "480p", quality: "high", filename: "phase10-final" } })); assert.equal(queued.response.status, 202); const jobId = queued.data.export._id;
  const {Wallet}=await import("../dist/models/Wallet.js");const {reserveCredits}=await import("../dist/services/wallet.js");
  await Wallet.updateOne({userId:user._id},{$setOnInsert:{userId:user._id,availableCredits:100}},{upsert:true});
  const reserve=await reserveCredits(String(user._id),{credits:10},"integrated-render-budget");
  await VideoExport.updateOne({_id:jobId},{$set:{productionId:production._id,reservationId:reserve._id,budgetCredits:2}});
  worker = spawn(process.execPath, [fileURLToPath(new URL("../dist/workers/renderWorker.js", import.meta.url))], { cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, env: { ...process.env, MONGODB_URI: db.getUri("drex_phase10_tests") }, stdio: ["ignore", "pipe", "pipe"] });
  worker.stdout.on("data", bytes => { workerLog += bytes; }); worker.stderr.on("data", bytes => { workerLog += bytes; });
  const completed = await waitFor(async () => { const job = await VideoExport.findById(jobId).lean(); if (job?.status === "failed") throw new Error(job.error); return job?.status === "completed" ? job : null; });
  const {CreditReservation}=await import("../dist/models/CreditReservation.js");
  await waitFor(async()=>((await CreditReservation.findById(reserve._id))?.status==="settled"));
  const {LedgerEntry}=await import("../dist/models/LedgerEntry.js");
  assert.equal(await LedgerEntry.countDocuments({idempotencyKey:`studio:${reserve._id}:final-render`}),1);
  assert.equal((await Wallet.findOne({userId:user._id})).spentCredits,2);
  assert.equal(completed.progress, 100); assert.ok(completed.key); assert.equal(completed.width, 854); assert.equal(completed.height, 480); assert.ok(Math.abs(completed.duration - 6.5) < 0.1);
  assert.ok(storageRequests.includes(`HEAD ${completed.key}`)); assert.ok(storageRequests.filter(r => r === `GET ${completed.key}`).length >= 1);
  const download = await fetch(base + `/exports/${jobId}/download`, { headers }); assert.equal(download.status, 200); assert.match(download.headers.get("content-disposition"), /phase10-final.mp4/);
  const bytes = Buffer.from(await download.arrayBuffer()); assert.deepEqual(bytes, objects.get(completed.key));
  exported = path.join(artifacts, "phase10-final.mp4"); await writeFile(exported, bytes);
  const probe = await probeMedia(exported); assert.equal(probe.videoCodec, "h264"); assert.equal(probe.audioCodec, "aac");
  assert.equal((await fetch(base + `/exports/${jobId}/download`)).status, 401);
  const saved = await request(`/exports/${jobId}/save`, json({})); assert.equal(saved.response.status, 200); assert.equal(String((await AIProject.findById(project._id)).finalExportId), jobId);
  assert.deepEqual((await request(`/edits/${edit._id}`)).data.edit.timeline, edit.timeline);
  await writeFile(path.join(artifacts, "phase10-verification.json"), JSON.stringify({ probe, bytes: bytes.length, durationExpected: 6.5, exportId: jobId, revision: edit.revision, storage: "local S3 protocol test server; no live R2 credentials used", worker: "dedicated FFmpeg process", timeline: edit.timeline }, null, 2));
});
test("exported audio starts at the correct timeline positions and captions are burned in", { timeout: 60000 }, async () => {
  assert.ok(exported, "Render must complete first");
  const pcm = path.join(directory, "decoded.f32");
  await runMedia("ffmpeg", ["-v", "error", "-y", "-i", exported, "-vn", "-ar", "48000", "-ac", "1", "-f", "f32le", pcm]);
  const bytes = await readFile(pcm);
  function amplitude(start, frequency) { let real = 0, imaginary = 0; const samples = 4800, offset = Math.round(start * 48000); for (let i = 0; i < samples; i++) { const value = bytes.readFloatLE((offset + i) * 4), angle = 2 * Math.PI * frequency * i / 48000; real += value * Math.cos(angle); imaginary += value * Math.sin(angle); } return Math.hypot(real, imaginary) / samples; }
  // Narration begins at intro(0.5) + source scene offset(0.25), not at the timeline origin.
  assert.ok(amplitude(0.9, 440) > amplitude(0.4, 440) * 8); assert.ok(amplitude(3.1, 440) > amplitude(2.6, 440) * 8);
  assert.ok(amplitude(0.4, 220) > 0.001, "Optional background music is mixed in");
  await runMedia("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", exported, "-frames:v", "1", path.join(artifacts, "phase10-caption-preview.png")]);
  const { data } = await sharp(path.join(artifacts, "phase10-caption-preview.png")).extract({ left: 20, top: 370, width: 814, height: 100 }).raw().toBuffer({ resolveWithObject: true });
  let whites = 0; for (let i = 0; i < data.length; i += 3) if (data[i] > 210 && data[i + 1] > 210 && data[i + 2] > 210) whites++;
  assert.ok(whites > 80, "White caption text must appear over the plain colored scene");
  await runMedia("ffmpeg", ["-v", "error", "-i", exported, "-f", "null", "-"]);
});
test("an unverified upload never becomes a completed export", { timeout: 120000 }, async () => {
  if (worker && worker.exitCode === null) { worker.kill(); await new Promise(resolve => worker.once("exit", resolve)); }
  const job = await VideoExport.create({ userId: user._id, editId: edit._id, projectId: project._id, revision: edit.revision, timeline: edit.timeline, settings: { format: "mp4", resolution: "480p", quality: "draft", filename: "failed-verification" } });
  await processVideoExport(String(job._id), { read: editorAssetBytes, upload: async () => { throw new Error("R2 read-back verification failed"); } });
  const failed = await VideoExport.findById(job._id); assert.equal(failed.status, "failed"); assert.equal(failed.completedAt, undefined); assert.match(failed.error, /read-back verification/);
});
test("portrait and square MP4 exports work without optional music or captions", { timeout: 120000 }, async () => {
  for (const ratio of ["9:16", "1:1"]) {
    const dir = path.join(directory, ratio.replace(":", "-")); await mkdir(dir);
    const timeline = timelineSchema.parse({ clips: [{ id: "title", kind: "title", label: "Original title", duration: 0.5, text: "Original", textStyle: { font: "Arial", size: 40, position: "center", preset: "boxed" } }], audio: [], captions: [], aspectRatio: ratio, musicDecision: "none" });
    const result = await renderTimeline(timeline, { format: "mp4", resolution: "480p", quality: "draft", filename: "aspect-test" }, new Map(), dir);
    assert.equal(result.width, 480); assert.equal(result.height, ratio === "1:1" ? 480 : 854); assert.ok(result.audio); assert.ok(Math.abs(result.duration - 0.5) < 0.1);
  }
});

test("visual upload validates bytes and permission for overlay sources",async()=>{
 const bytes=await sharp({create:{width:128,height:128,channels:4,background:"#44aa88"}}).png().toBuffer();
 const options={method:"POST",headers:{"Content-Type":"image/png","x-license-confirmed":"true","x-file-name":"Original logo.png"},body:bytes};
 const result=await request("/edits/"+edit._id+"/visual",options);assert.equal(result.response.status,201);assert.equal(result.data.asset.type,"image");assert.equal(result.data.asset.metadata.licenseConfirmed,true);
 const denied=await request("/edits/"+edit._id+"/visual",{...options,headers:{...options.headers,"x-license-confirmed":"false"}});assert.equal(denied.response.status,400);
 const malformed=await request("/edits/"+edit._id+"/visual",{...options,body:Buffer.from("not an image")});assert.ok(malformed.response.status>=400);
});

test("blank editor opens without a Studio production and retries preserve one saved edit",async()=>{
 const requestId=crypto.randomUUID();const count=await VideoEdit.countDocuments({userId:user._id});
 const first=await request("/blank",json({requestId}));assert.equal(first.response.status,201);assert.equal(first.data.edit.timeline.clips.length,0);
 const again=await request("/blank",json({requestId}));assert.equal(again.data.edit._id,first.data.edit._id);assert.equal(await VideoEdit.countDocuments({userId:user._id}),count+1);
 const loaded=await request("/edits/"+first.data.edit._id);assert.equal(loaded.response.status,200);assert.equal(loaded.data.edit.title,"Untitled video");
});
