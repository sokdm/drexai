import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";
import { youtubeChannelRouter } from "../dist/routes/youtubeChannel.js";
import { youtubeRouter } from "../dist/routes/youtube.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { YouTubeConnection } from "../dist/models/YouTubeConnection.js";
import { YouTubeUpload } from "../dist/models/YouTubeUpload.js";
import { encryptSecret } from "../dist/utils/encryption.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { env } from "../dist/config/env.js";
import { googleAuthUrl } from "../dist/services/youtube.js";

let db, server, base, headers, user, savedJob;
const uploadScope = "https://www.googleapis.com/auth/youtube.upload", readonly = "https://www.googleapis.com/auth/youtube.readonly";
const remotes = new Map(), requests = [], state = { failAfterAck: false, wrongOwner: false, badLocation: false, thumbnails: 0 };
const originalFetch = globalThis.fetch, originalError = console.error;
const input = { confirmed: true, title: "Original test video", description: "A test only. Never sent to Google.", fileName: "original.mp4", fileSize: 256 * 1024 + 100, contentType: "video/mp4", madeForKids: false, syntheticMedia: true };
const channel = { id: "my-channel", snippet: { title: "My original channel", description: "A creator profile", customUrl: "@original", thumbnails: { high: { url: "https://ytimg.example/avatar.jpg" } } }, contentDetails: { relatedPlaylists: { uploads: "uploads-list" } }, statistics: { subscriberCount: "120", videoCount: "3", viewCount: "900" } };
const googleVideo = id => ({ id, snippet: { channelId: "my-channel", title: "Uploaded video" }, status: { privacyStatus: "private" } });
before(async () => {
  env.GOOGLE_CLIENT_ID = "test-client";
  db = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("drex_publish_tests"));
  user = await User.create({ displayName: "Publisher", email: "publisher@example.test", passwordHash: "test-only", status: "active" });
  await Session.create({ userId: user._id, tokenHash: hashSecret("publish-test"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  await YouTubeConnection.create({ userId: user._id, channelId: "my-channel", channelTitle: channel.snippet.title, scopes: [readonly], accessTokenEncrypted: encryptSecret("test-access-token"), expiresAt: new Date(Date.now() + 3600000) });
  headers = { Cookie: "drex_session=publish-test", "x-csrf-token": "csrf", "Content-Type": "application/json" };
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api/youtube", youtubeRouter, youtubeChannelRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}/api/youtube`;
  console.error = (...args) => { if (!args[0]?.statusCode && args[0]?.name !== "ZodError" && args[0]?.message !== "Simulated dropped response") originalError(...args); };
  // Only local HTTP is real. Every Google request is intercepted; these tests never post to YouTube.
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith(base)) return originalFetch(url, options);
    const parsed = new URL(String(url)); if (parsed.hostname !== "www.googleapis.com") throw new Error("Unexpected external request in publishing test");
    const path = parsed.pathname; requests.push({ path, method: options.method || "GET", headers: options.headers });
    if (path === "/youtube/v3/channels") return Response.json({ items: [channel] });
    if (path === "/youtube/v3/playlistItems") return Response.json({ items: [{ contentDetails: { videoId: "own-video" } }] });
    if (path === "/youtube/v3/videos") return Response.json({ items: [{ id: parsed.searchParams.get("id") || "own-video", snippet: { ...channel.snippet, channelId: state.wrongOwner ? "someone-else" : "my-channel" }, contentDetails: { duration: "PT48S" }, status: { privacyStatus: "private" }, statistics: { viewCount: "10" } }] });
    if (path === "/upload/youtube/v3/thumbnails/set") { state.thumbnails++; assert.equal(new Uint8Array(options.body)[0], 255); return Response.json({ items: [{ high: { url: "https://ytimg.example/new-thumbnail.jpg" } }] }); }
    if (path === "/upload/youtube/v3/videos" && options.method === "POST") {
      const id = `remote-${remotes.size + 1}`; const metadata = JSON.parse(options.body); remotes.set(id, { size: Number(options.headers["X-Upload-Content-Length"]), received: 0, metadata, id: `video-${id}` });
      return new Response(null, { status: 200, headers: { location: state.badLocation ? "https://attacker.example/upload?upload_id=bad" : `https://www.googleapis.com/upload/youtube/v3/videos?upload_id=${id}&uploadType=resumable` } });
    }
    if (path === "/upload/youtube/v3/videos" && options.method === "PUT") {
      const remote = remotes.get(parsed.searchParams.get("upload_id")); const range = options.headers["Content-Range"];
      if (!range.startsWith("bytes */")) { const match = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/); assert.equal(Number(match[1]), remote.received); assert.equal(Number(match[2]) - Number(match[1]) + 1, options.body.byteLength); remote.received = Number(match[2]) + 1; }
      if (state.failAfterAck) { state.failAfterAck = false; throw new Error("Simulated dropped response"); }
      return remote.received === remote.size ? Response.json(googleVideo(remote.id), { status: 201 }) : new Response(null, { status: 308, headers: remote.received ? { range: `bytes=0-${remote.received - 1}` } : {} });
    }
    throw new Error(`Unexpected Google request ${path}`);
  };
});
after(async () => { globalThis.fetch = originalFetch; console.error = originalError; server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db?.stop(); });
async function request(path, options = {}) { const response = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers } }); return { status: response.status, data: await response.json() }; }
const post = body => ({ method: "POST", body: JSON.stringify(body) });

test("connected profile includes private uploads and never needs a public search key", async () => {
  const result = await request("/my-channel"); assert.equal(result.status, 200); assert.equal(result.data.channel.title, channel.snippet.title); assert.equal(result.data.videos[0].privacy, "private"); assert.equal(result.data.canUpload, false);
  assert.equal((await originalFetch(base + "/my-channel")).status, 401);
});
test("upload permission must be explicitly enabled and OAuth requests it only when asked", async () => {
  assert.ok(!new URL(googleAuthUrl("state")).searchParams.get("scope").includes(uploadScope)); assert.ok(new URL(googleAuthUrl("state", true)).searchParams.get("scope").includes(uploadScope));
  assert.equal((await request("/uploads", post(input))).status, 403);
  await YouTubeConnection.updateOne({ userId: user._id }, { $set: { scopes: [readonly, uploadScope] } });
  assert.equal((await originalFetch(base + "/uploads", { ...post(input), headers: { Cookie: headers.Cookie, "Content-Type": "application/json" } })).status, 403);
});
test("resumable upload defaults to private and keeps provider credentials server-side", async () => {
  const result = await request("/uploads", post(input)); assert.equal(result.status, 201); savedJob = result.data.upload;
  assert.equal(savedJob.privacy, "private"); assert.equal(savedJob.uploadedBytes, 0); assert.ok(!JSON.stringify(result.data).includes("upload_id")); assert.ok(!JSON.stringify(result.data).includes("test-access-token"));
  const remote = [...remotes.values()].at(-1); assert.equal(remote.metadata.status.privacyStatus, "private"); assert.equal(remote.metadata.status.containsSyntheticMedia, true);
  const stored = await YouTubeUpload.findById(savedJob._id); assert.ok(!stored.uploadUrlEncrypted.includes("googleapis"));
});

test("Phase 11 uploads require confirmation, validate scheduling and send reviewed tags", async () => {
  const before = remotes.size;
  assert.equal((await request("/uploads", post({ ...input, confirmed: false }))).status, 400);
  assert.equal((await request("/uploads", post({ ...input, publishAt: new Date(Date.now() + 3600000).toISOString(), privacy: "public" }))).status, 400);
  assert.equal((await request("/uploads", post({ ...input, publishAt: new Date(Date.now() - 3600000).toISOString() }))).status, 400);
  assert.equal((await request("/uploads", post({ ...input, tags: Array(10).fill("a".repeat(100)) }))).status, 400);
  assert.equal(remotes.size, before);
  const publishAt = new Date(Date.now() + 86400000).toISOString();
  const result = await request("/uploads", post({ ...input, tags: ["original story", "city"], publishAt })); assert.equal(result.status, 201);
  const remote = [...remotes.values()].at(-1); assert.deepEqual(remote.metadata.snippet.tags, ["original story", "city"]); assert.equal(remote.metadata.status.publishAt, publishAt); assert.equal(remote.metadata.status.privacyStatus, "private");
  assert.equal(result.data.upload.channelTitle, channel.snippet.title);
});
test("only provider acknowledgements advance progress; only a confirmed video completes it", async () => {
  const first = await request(`/uploads/${savedJob._id}/chunk`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-upload-offset": "0" }, body: Buffer.alloc(256 * 1024) });
  assert.equal(first.status, 200); assert.equal(first.data.upload.uploadedBytes, 256 * 1024); assert.equal(first.data.upload.status, "uploading");
  const stale = await request(`/uploads/${savedJob._id}/chunk`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-upload-offset": "0" }, body: Buffer.alloc(100) }); assert.equal(stale.status, 409);
  const last = await request(`/uploads/${savedJob._id}/chunk`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-upload-offset": String(256 * 1024) }, body: Buffer.alloc(100) }); assert.equal(last.status, 200); assert.equal(last.data.upload.status, "completed"); assert.equal(last.data.upload.uploadedBytes, input.fileSize); assert.match(last.data.upload.videoUrl, /youtube.com/);
});
test("a lost final response recovers the same video without creating another upload", async () => {
  const created = (await request("/uploads", post({ ...input, fileSize: 100 }))).data.upload; const before = remotes.size; state.failAfterAck = true;
  assert.equal((await request(`/uploads/${created._id}/chunk`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-upload-offset": "0" }, body: Buffer.alloc(100) })).status, 500);
  assert.equal((await YouTubeUpload.findById(created._id)).status, "uploading");
  const recovered = await request(`/uploads/${created._id}`); assert.equal(recovered.data.upload.status, "completed"); assert.equal(remotes.size, before);
});
test("thumbnail uploads validate image content and video ownership", async () => {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const opts = { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes };
  const thumbnail = await request("/my-videos/own-video/thumbnail", opts); assert.equal(thumbnail.status, 200); assert.match(thumbnail.data.thumbnail, /new-thumbnail/);
  const before = state.thumbnails; state.wrongOwner = true; assert.equal((await request("/my-videos/foreign-video/thumbnail", opts)).status, 404); assert.equal(state.thumbnails, before); state.wrongOwner = false;
  assert.equal((await request("/my-videos/own-video/thumbnail", { ...opts, body: Buffer.from("not an image") })).status, 400);
});
test("foreign sessions and non-Google upload URLs are rejected", async () => {
  const foreign = await YouTubeUpload.create({ userId: new mongoose.Types.ObjectId(), channelId: "my-channel", fileSize: 100, uploadUrlEncrypted: encryptSecret("https://www.googleapis.com/upload/youtube/v3/videos?upload_id=foreign") });
  assert.equal((await request(`/uploads/${foreign._id}`)).status, 404);
  state.badLocation = true; assert.equal((await request("/uploads", post(input))).status, 400); state.badLocation = false;
  const failed = await YouTubeUpload.findOne({ userId: user._id, status: "failed" }); assert.ok(failed); assert.match(failed.error, /could not start/); assert.equal(failed.uploadUrlEncrypted, undefined);
  const history = await request("/uploads"); assert.ok(history.data.uploads.some(job => job.status === "failed" && job.error));
  assert.equal((await request("/uploads", post({ ...input, fileSize: 3 * 1024 * 1024 * 1024 }))).status, 400);
});
