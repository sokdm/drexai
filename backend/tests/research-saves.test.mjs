import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { youtubeRouter } from "../dist/routes/youtube.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { ResearchCollection } from "../dist/models/ResearchCollection.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";

let db, server, base, headers, collectionId;
before(async () => {
  db = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
  await mongoose.connect(db.getUri("drex_research_save_tests"));
  const user = await User.create({ displayName: "Research save test", email: "research-save@example.test", passwordHash: "test-only", status: "active" });
  await Session.create({ userId: user._id, tokenHash: hashSecret("research-save-test"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  headers = { Cookie: "drex_session=research-save-test", "x-csrf-token": "csrf", "Content-Type": "application/json" };
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api/youtube", youtubeRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); }); base = `http://127.0.0.1:${server.address().port}/api/youtube`;
  const response = await fetch(base + "/collections", { headers }); const data = await response.json(); collectionId = data.collections[0]._id;
});
after(async () => { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db?.stop(); });
const save = item => fetch(base + `/collections/${collectionId}/items`, { method: "POST", headers, body: JSON.stringify(item) });

test("repeated concurrent saves create one bookmark and retain saved metadata", async () => {
  const item = { itemType: "video", youtubeId: "video-1", title: "Original video", metadata: { duration: "PT48S" } };
  const responses = await Promise.all(Array.from({ length: 6 }, () => save(item)));
  assert.ok(responses.every(response => response.status === 200));
  const restored = await (await fetch(base + "/collections", { headers })).json();
  assert.equal(restored.collections[0].items.length, 1); assert.equal(restored.collections[0].items[0].metadata.duration, "PT48S");
});
test("different simultaneous saves do not overwrite one another", async () => {
  const responses = await Promise.all([save({ itemType: "video", youtubeId: "video-2", title: "Second video" }), save({ itemType: "channel", youtubeId: "channel-1", title: "Original channel" })]);
  assert.ok(responses.every(response => response.status === 200)); const collection = await ResearchCollection.findById(collectionId);
  assert.equal(collection.items.length, 3);
});
test("saved research remains owner protected and can be removed", async () => {
  assert.equal((await fetch(base + "/collections")).status, 401);
  const foreign = await ResearchCollection.create({ userId: new mongoose.Types.ObjectId(), name: "Other user" });
  const response = await fetch(base + `/collections/${foreign._id}/items`, { method: "POST", headers, body: JSON.stringify({ itemType: "video", youtubeId: "foreign" }) }); assert.equal(response.status, 404);
  assert.equal((await ResearchCollection.findById(foreign._id)).items.length, 0);
  const own = await ResearchCollection.findById(collectionId); const itemId = own.items[0]._id;
  const deleted = await fetch(base + `/collections/${collectionId}/items/${itemId}`, { method: "DELETE", headers }); assert.equal(deleted.status, 200);
  assert.equal((await ResearchCollection.findById(collectionId)).items.length, 2);
});
