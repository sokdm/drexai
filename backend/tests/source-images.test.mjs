import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import sharp from "sharp";
import express from "express";
import cookieParser from "cookie-parser";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const directory = await mkdtemp(path.join(tmpdir(), "drex-upload-test-"));
Object.assign(process.env, { UPLOAD_DIR: directory, NODE_ENV: "test", IMAGE_QUEUE_ENABLED: "false", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "" });
const { videosRouter } = await import("../dist/routes/videos.js");
const { normalizeSourceImage, readSourceImage } = await import("../dist/services/sourceImages.js");
const { User } = await import("../dist/models/User.js");
const { Session } = await import("../dist/models/Session.js");
const { MediaAsset } = await import("../dist/models/MediaAsset.js");
const { hashSecret } = await import("../dist/utils/crypto.js");
const { errorHandler } = await import("../dist/middleware/errorHandler.js");
const { VideoGenerationJob } = await import("../dist/models/VideoGenerationJob.js");
const { processVideoJob } = await import("../dist/workers/processVideoJob.js");
const { env } = await import("../dist/config/env.js");
env.GEMINI_API_KEY = "test-only";
let db, server, base, headers, image;
before(async () => {
  db = await MongoMemoryReplSet.create({ binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri("drex_upload_tests"));
  const user = await User.create({ displayName: "Upload test", email: "upload@example.test", passwordHash: "test-only", status: "active" });
  await Session.create({ userId: user._id, tokenHash: hashSecret("upload-test"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 60000) });
  headers = { Cookie: "drex_session=upload-test", "x-csrf-token": "csrf", "Content-Type": "image/png", "x-file-name": "test.png" };
  image = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#14b8a6" } }).png().toBuffer();
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api/videos", videosRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/videos`;
});
after(async () => {
  server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); await db?.stop();
  // Only remove this test's own uniquely-created temporary directory.
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("drex-upload-test-")) throw new Error("Unexpected test cleanup path");
  await rm(directory, { recursive: true, force: true });
});
test("validates image contents and rejects SVG, corrupt files, and oversized input", async () => {
  const normalized = await normalizeSourceImage(image);
  assert.equal(normalized.info.width, 80); assert.equal(normalized.info.height, 60);
  await assert.rejects(normalizeSourceImage(Buffer.from("not an image")), /could not be read/);
  await assert.rejects(normalizeSourceImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')), /could not be read/);
  await assert.rejects(normalizeSourceImage(Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MB/);
});
test("upload requires authentication and CSRF", async () => {
  assert.equal((await fetch(base + "/source-images", { method: "POST", body: image, headers: { "Content-Type": "image/png" } })).status, 401);
  assert.equal((await fetch(base + "/source-images", { method: "POST", body: image, headers: { Cookie: headers.Cookie, "Content-Type": "image/png" } })).status, 403);
});
test("uploads to private storage, previews only for owner, and resolves actual provider bytes", async () => {
  const response = await fetch(base + "/source-images", { method: "POST", headers, body: image });
  assert.equal(response.status, 201); const { asset } = await response.json();
  assert.equal(asset.storageProvider, "local-upload"); assert.equal(asset.width, 80);
  assert.ok(!asset.url.startsWith("data:")); assert.equal(asset.jobId, undefined);
  const source = await MediaAsset.findById(asset._id);
  const bytes = await readSourceImage(source); assert.equal((await sharp(bytes.buffer).metadata()).width, 80);
  assert.equal((await fetch(base + `/source-images/${asset._id}/content`, { headers })).status, 200);
  assert.equal((await fetch(base + `/source-images/${asset._id}/content`)).status, 401);
  const foreign = await MediaAsset.create({ ...source.toObject(), _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId() });
  assert.equal((await fetch(base + `/source-images/${foreign._id}/content`, { headers })).status, 404);
  const quote = await fetch(base + "/quote", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ sourceImageAssetId: String(foreign._id), motionPrompt: "A slow camera move", model: "veo-3.1-generate-preview", aspectRatio: "16:9", durationSeconds: 8, quality: "720p", quantity: 1 }) });
  assert.equal(quote.status, 404);
  const job = await VideoGenerationJob.create({ userId: source.userId, sourceImageAssetId: source._id, motionPrompt: "Gentle movement", model: "veo-3.1-generate-preview", aspectRatio: "16:9", durationSeconds: 8, quality: "720p", quantity: 1, status: "queued" });
  const originalFetch = globalThis.fetch; let sent;
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes(":predictLongRunning")) { sent = JSON.parse(options.body); return Response.json({ name: "operations/upload-test" }); }
      if (String(url).includes("/operations/upload-test")) return Response.json({ done: true, response: { generatedVideos: [{ video: { videoBytes: Buffer.from("mock clip").toString("base64") } }] } });
      throw new Error("Unexpected provider call in test");
    };
    await processVideoJob(String(job._id));
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(sent.instances[0].image.inlineData.data, bytes.buffer.toString("base64"));
  assert.equal(sent.instances[0].image.inlineData.mimeType, "image/png");
  assert.equal((await VideoGenerationJob.findById(job._id)).status, "completed");
});
