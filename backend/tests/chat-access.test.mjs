import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { fileURLToPath } from "node:url";
import { ChatUsage, chatStatus, admitChatMessage, chatWindow, publicChatError } from "../dist/services/chatAccess.js";
import { PricingPolicy } from "../dist/models/Finance.js";
let db;
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
  await mongoose.connect(db.getUri("chat_access"));
  await ChatUsage.init();
  await PricingPolicy.create({ _id: "global", values: { chatMessagesPerWindow: 2 } });
});
after(async () => { await mongoose.disconnect(); await db.stop(); });
test("shared four-hour allowance is atomic, idempotent and independent of API key or wallet", async () => {
  const user = String(new mongoose.Types.ObjectId()), now = new Date("2026-10-18T07:59:59Z");
  await admitChatMessage(user, "same-message", now);
  await admitChatMessage(user, "same-message", now);
  assert.equal((await chatStatus(user, now)).used, 1);
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => admitChatMessage(user, "message-" + i, now)));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  const rejected = attempts.find(a => a.status === "rejected").reason;
  assert.equal(rejected.code, "CHAT_LIMIT");
  assert.equal(rejected.resetsAt.toISOString(), "2026-10-18T08:00:00.000Z");
  const reset = new Date("2026-10-18T08:00:00Z");
  assert.equal((await chatStatus(user, reset)).remaining, 2);
  await admitChatMessage(user, "after-reset", reset);
  assert.equal((await chatStatus(user, reset)).used, 1);
  assert.equal((await chatStatus(String(new mongoose.Types.ObjectId()), now)).remaining, 2);
  assert.equal(chatWindow(reset).resetsAt.toISOString(), "2026-10-18T12:00:00.000Z");
});
test("provider and administrator errors stay private while reset errors remain useful", () => {
  for (const message of ["Admin pricing unavailable", "OPENROUTER_API_KEY is missing", "No model fits the one-credit budget", "MongoDB unavailable"]) {
    const result = publicChatError(new Error(message));
    assert.match(result, /temporarily/);
    assert.doesNotMatch(result, /admin|pricing|OpenRouter|model|Mongo|one-credit/i);
  }
});
