import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";
import { youtubeWatchRouter } from "../dist/routes/youtubeWatch.js";
import { youtubeRouter } from "../dist/routes/youtube.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { YouTubeConnection } from "../dist/models/YouTubeConnection.js";
import { YouTubeCache } from "../dist/models/YouTubeCache.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { encryptSecret } from "../dist/utils/encryption.js";
import { env } from "../dist/config/env.js";
import { googleAuthUrl, youtubeCommentScope } from "../dist/services/youtube.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
let db, server, base, headers, user;
const originalFetch = globalThis.fetch, id = "abcdefghijk", calls = [], state = { disabled: false, quota: false, foreignParent: false };
before(async () => {
  env.YOUTUBE_API_KEY = "test-key"; env.GOOGLE_CLIENT_ID = "test-client";
  db = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("drex_watch_tests"));
  user = await User.create({ displayName: "Watch test", email: "watch@example.test", passwordHash: "test", status: "active" });
  await Session.create({ userId: user._id, tokenHash: hashSecret("watch-test"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  await YouTubeConnection.create({ userId: user._id, channelId: "UCviewer", channelTitle: "Viewer", scopes: ["https://www.googleapis.com/auth/youtube.readonly"], accessTokenEncrypted: encryptSecret("test-access"), expiresAt: new Date(Date.now() + 3600000) });
  headers = { Cookie: "drex_session=watch-test", "x-csrf-token": "csrf", "Content-Type": "application/json" };
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api/youtube", youtubeRouter, youtubeWatchRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}/api/youtube`;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith(base)) return originalFetch(url, options);
    const u = new URL(String(url)); assert.equal(u.hostname, "www.googleapis.com"); calls.push({ url: u, options });
    const kind = u.pathname.split("/").pop(), posting = options.method === "POST";
    if (posting) { assert.equal(options.headers.Authorization, "Bearer test-access"); const body = JSON.parse(options.body); return Response.json(kind === "comments" ? { id: "reply-created", snippet: { textOriginal: body.snippet.textOriginal } } : { snippet: { topLevelComment: { id: "created", snippet: { textOriginal: body.snippet.topLevelComment.snippet.textOriginal } } } }, { status: 201 }); }
    if (state.quota) return Response.json({ error: { message: "Quota exceeded", errors: [{ reason: "quotaExceeded" }] } }, { status: 403 });
    if (kind === "videos") return Response.json({ items: u.searchParams.get("id").split(",").map(key => ({ id: key, snippet: { title: "Original science video", channelId: "UCsource", channelTitle: "Science", tags: ["science"], description: "Original description" }, status: { embeddable: true }, statistics: { viewCount: "100" }, topicDetails: { topicCategories: ["https://en.wikipedia.org/wiki/Science"] } })) });
    if (kind === "search") { assert.equal(u.searchParams.has("relatedToVideoId"), false); assert.equal(u.searchParams.get("videoEmbeddable"), "true"); return Response.json({ items: [{ id: { videoId: id } }, { id: { videoId: "lmnopqrstuv" } }], nextPageToken: "page2" }); }
    if (kind === "commentThreads") { if (state.disabled) return Response.json({ error: { errors: [{ reason: "commentsDisabled" }] } }, { status: 403 }); return Response.json({ items: [{ snippet: { videoId: id, totalReplyCount: 2, topLevelComment: { id: "parent-1", snippet: { textOriginal: "Real plain text <b>hello</b>", authorDisplayName: "Viewer", likeCount: 2 } } } }], nextPageToken: "comments2" }); }
    if (kind === "comments") return Response.json({ items: [{ id: "reply-1", snippet: { videoId: state.foreignParent ? "other-video" : id, textOriginal: "Reply", authorDisplayName: "Other viewer" } }], nextPageToken: "replies2" });
    throw new Error(`Unexpected Google request ${url}`);
  };
});
after(async () => { globalThis.fetch = originalFetch; server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db?.stop(); });
async function request(path, options = {}) { const r = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers } }); return { status: r.status, data: await r.json() }; }
const post = body => ({ method: "POST", body: JSON.stringify(body) });
test("watch details and recommendations are cached, relevant, deduplicated and embedding-safe", async () => {
  assert.equal((await originalFetch(base + `/watch/${id}`)).status, 401);
  const result = await request(`/watch/${id}`); assert.equal(result.data.video.title, "Original science video"); assert.equal(result.data.video.embeddable, true); assert.ok(!JSON.stringify(result.data).includes("test-key"));
  const rec = await request(`/watch/${id}/recommendations`); assert.equal(rec.data.items.length, 1); assert.equal(rec.data.items[0].id, "lmnopqrstuv"); const before = calls.length; await request(`/watch/${id}/recommendations`); assert.equal(calls.length, before);
  assert.ok(calls.find(c => c.url.pathname.endsWith("search") && c.url.searchParams.get("q")?.includes("science"))); assert.ok(calls.find(c => c.url.searchParams.get("channelId") === "UCsource"));
  await YouTubeCache.updateMany({}, { expiresAt: new Date(0) }); assert.equal((await request(`/watch/${id}`)).status, 200);
});
test("actual comment thread fields, sorting, pagination and replies use supported API parameters", async () => {
  const c = await request(`/watch/${id}/comments?order=time&pageToken=next`); assert.equal(c.data.items[0].text, "Real plain text <b>hello</b>"); assert.equal(c.data.items[0].replyCount, 2); assert.equal(c.data.nextPageToken, "comments2");
  const call = calls.find(c => c.url.searchParams.get("order") === "time"); assert.equal(call.url.searchParams.get("textFormat"), "plainText"); assert.equal(call.url.searchParams.get("pageToken"), "next");
  assert.equal((await request("/comment-replies/parent-1")).data.items[0].text, "Reply");
});
test("disabled comments and quota return useful states; invalid IDs are rejected", async () => {
  state.disabled = true; assert.equal((await request(`/watch/${id}/comments?order=relevance`)).data.disabled, true); state.disabled = false;
  state.quota = true; await YouTubeCache.deleteMany({}); assert.equal((await request(`/watch/${id}`)).status, 429); state.quota = false;
  assert.equal((await request("/watch/bad")).status, 400);
});
test("comment posting requires explicit scope and CSRF; requests post only confirmed text", async () => {
  assert.ok(!new URL(googleAuthUrl("state")).searchParams.get("scope").includes(youtubeCommentScope)); assert.ok(new URL(googleAuthUrl("state", false, true)).searchParams.get("scope").includes(youtubeCommentScope));
  assert.equal((await request(`/watch/${id}/comments`, post({ text: "My comment" }))).status, 403);
  await YouTubeConnection.updateOne({ userId: user._id }, { $push: { scopes: youtubeCommentScope } });
  assert.equal((await request(`/watch/${id}/comments`, { ...post({ text: "My comment" }), headers: { "x-csrf-token": "wrong" } })).status, 403);
  const result = await request(`/watch/${id}/comments`, post({ text: "My comment" })); assert.equal(result.status, 201); assert.equal(result.data.comment.text, "My comment");
  const reply = await request(`/watch/${id}/comments`, post({ text: "My reply", parentId: "parent-1" })); assert.equal(reply.status, 201); assert.equal(reply.data.comment.text, "My reply");
  state.foreignParent = true; assert.equal((await request(`/watch/${id}/comments`, post({ text: "Wrong video", parentId: "other-parent" }))).status, 400); state.foreignParent = false;
  assert.equal((await request(`/watch/${id}/comments`, post({ text: " " }))).status, 400);
});
