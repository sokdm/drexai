import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { calculateCreditPrice, defaultPricingPolicy, quoteAutomaticCredits } from "../dist/services/creditPricingEngine.js";
import { seedCreditConfig, reserveCredits, releaseReservation, settleReservation } from "../dist/services/wallet.js";
import { GatewayUsage } from "../dist/services/openrouter.js";
import { syncProviderRecord, checkProviderAffordability } from "../dist/services/openrouterManagement.js";
import { PricingPolicy, PricingOverride, ProviderSnapshot, ProviderActivity, DailySpendBudget, AppMigration } from "../dist/models/Finance.js";
import { CreditPackage } from "../dist/models/CreditPackage.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { Wallet } from "../dist/models/Wallet.js";
import { CreditReservation } from "../dist/models/CreditReservation.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { AdminSession, AdminAudit } from "../dist/models/Admin.js";
import { accountRouter } from "../dist/routes/account.js";
import { adminRouter } from "../dist/routes/admin.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { env } from "../dist/config/env.js";
import { dispatchGeneration, runMongoGenerationTick } from "../dist/services/generationDispatch.js";
import { ImageGenerationJob } from "../dist/models/ImageGenerationJob.js";
import { VideoGenerationJob } from "../dist/models/VideoGenerationJob.js";
let db, server, base, user, other, adminHeaders;
const realFetch = globalThis.fetch;
before(async () => {
 db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }], binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("finance_settings"));
 for (const m of [CreditPackage, AppMigration, CreditReservation, LedgerEntry, Wallet, DailySpendBudget, ProviderActivity]) await m.init();
 user = await User.create({ displayName: "Customer", email: "settings@example.test", passwordHash: "test", status: "active" });
 other = await User.create({ displayName: "Other", email: "other@example.test", passwordHash: "test", status: "active" });
 await Session.create({ userId: user._id, tokenHash: hashSecret("settings-session"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
 const admin = await User.create({ displayName: "Admin", email: "finance-admin@example.test", passwordHash: "test", status: "active", role: "admin" });
 await AdminSession.create({ userId: admin._id, tokenHash: hashSecret("finance-admin"), csrfHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
 adminHeaders = { Cookie: "drex_admin=finance-admin", "x-admin-csrf": "csrf" };
 const app = express(); app.use(express.json(), cookieParser()); app.use("/api/account", accountRouter); app.use("/api/admin", adminRouter); app.use(errorHandler);
 server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { globalThis.fetch = realFetch; server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await db?.stop(); });
async function api(path, method = "GET", body, headers = { Cookie: "drex_session=settings-session", "x-csrf-token": "csrf" }) { const res = await realFetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() }; }
test("requested packages migrate legacy prices once and preserve later admin edits", async () => {
 await CreditPackage.create([{ key: "starter", name: "Starter", credits: 1000, amount: 15, currency: "USD", active: true }, { key: "creator", name: "Creator", credits: 5000, amount: 50, currency: "USD", active: true }]);
 await seedCreditConfig(); assert.equal((await CreditPackage.findOne({ key: "starter" })).amount, 20); assert.equal((await CreditPackage.findOne({ key: "creator" })).amount, 90); assert.equal((await CreditPackage.findOne({ key: "mini" })).credits, 500);
 await CreditPackage.updateOne({ key: "starter" }, { amount: 22 }); await seedCreditConfig(); assert.equal((await CreditPackage.findOne({ key: "starter" })).amount, 22); assert.equal(await AppMigration.countDocuments(), 1);
});
test("decimal pricing uses cheapest package, protects margin and scales image quantity", () => {
 const packages = [{ amount: 10, credits: 500 }, { amount: 20, credits: 1000 }, { amount: 90, credits: 5000 }];
 const low = calculateCreditPrice("0.01", packages, defaultPricingPolicy, 1, true); assert.equal(low.credits, 5); assert.equal(low.creditUsd, "0.018");
 assert.equal(calculateCreditPrice("0.02", packages, defaultPricingPolicy, 2, true).credits, 10);
 const expensive = calculateCreditPrice("0.04", packages, defaultPricingPolicy, 1, true); assert.equal(expensive.credits, 7); assert.ok(Number(expensive.estimatedMarginPct) >= 66);
 assert.throws(() => calculateCreditPrice("NaN", packages, defaultPricingPolicy), /positive verified/);
 assert.throws(() => calculateCreditPrice("1", [], defaultPricingPolicy), /active USD/);
});
test("settings accept empty picture URL, preserve preferences and never return passwords", async () => {
 const saved = await api("/api/account/profile", "PATCH", { displayName: "Updated Customer", profilePictureUrl: "", preferences: { appearance: "light", supportEmails: false } });
 assert.equal(saved.status, 200); assert.equal(saved.data.user.preferences.appearance, "light"); assert.equal(saved.data.user.preferences.supportEmails, false); assert.ok(!JSON.stringify(saved.data).includes("passwordHash"));
 await api("/api/account/profile", "PATCH", { preferences: { emailUpdates: false } }); const persisted = await User.findById(user._id); assert.equal(persisted.preferences.supportEmails, false); assert.equal(persisted.preferences.appearance, "light");
 assert.equal((await api("/api/account/profile", "PATCH", { profilePictureUrl: "javascript:alert(1)" })).status, 400);
 assert.equal((await api("/api/account/profile", "PATCH", { displayName: "Lost" }, {})).status, 401);
 assert.equal((await api("/api/account/profile", "PATCH", { displayName: "Lost" }, { Cookie: "drex_session=settings-session" })).status, 403);
});
test("device sessions expose current status and enforce ownership when revoking", async () => {
 const extra = await Session.create({ userId: user._id, tokenHash: "extra", csrfTokenHash: "extra-csrf", expiresAt: new Date(Date.now() + 3600000) });
 const foreign = await Session.create({ userId: other._id, tokenHash: "foreign", csrfTokenHash: "foreign-csrf", expiresAt: new Date(Date.now() + 3600000) });
 const list = await api("/api/account/sessions"); assert.equal(list.data.sessions.length, 2); assert.equal(list.data.sessions.filter(s => s.current).length, 1); assert.ok(!JSON.stringify(list.data).includes("tokenHash"));
 assert.equal((await api(`/api/account/sessions/${foreign._id}`, "DELETE")).status, 404); assert.equal((await api(`/api/account/sessions/${extra._id}`, "DELETE")).status, 200);
});
test("automatic pricing policies require admin and CSRF, persist and detect stale edits", async () => {
 assert.equal((await api("/api/admin/pricing-policy")).status, 401);
 const body = { revision: 1, values: defaultPricingPolicy, reason: "Verify automatic pricing and spending limits" };
 assert.equal((await api("/api/admin/pricing-policy", "PUT", body, { Cookie: adminHeaders.Cookie })).status, 403);
 assert.equal((await api("/api/admin/pricing-policy", "PUT", body, adminHeaders)).status, 200);
 assert.equal((await api("/api/admin/pricing-policy", "PUT", body, adminHeaders)).status, 409);
 assert.ok(await AdminAudit.exists({ action: "pricing-policy" }));
});
test("verified cost bounds scale quantity and expired bounds fail closed without generation", async () => {
 const model = "openrouter/test/verified";
 await PricingOverride.create({ feature: "text_to_image", model, unit: "image:1K", costUsd: "0.04", expiresAt: new Date(Date.now() + 60000), verifiedAt: new Date(), verificationUrl: "https://example.test/cost", settings: { resolution: "1K" } });
 const quote = await quoteAutomaticCredits({ feature: "text_to_image", model, unit: "image:1K", quantity: 2, settings: { resolution: "1K" } }); assert.equal(quote.credits, 14); assert.equal(quote.estimatedCostUsd, .08);
 await assert.rejects(() => quoteAutomaticCredits({ feature: "text_to_image", model, unit: "image:1K", quantity: 2, settings: { resolution: "4K" } }), /does not cover/);
});
test("published text rates and native-audio video rates scale duration, outputs and resolution", async () => {
 const saved = globalThis.fetch; let calls = 0;
 globalThis.fetch = async url => { calls++; assert.ok(!String(url).includes("chat/completions")); return Response.json({ data: String(url).endsWith("videos/models") ? [{ id: "google/veo-3.1", pricing: { duration_seconds_with_audio: ".40", duration_seconds_with_audio_4k: ".60" } }] : [{ id: "google/gemini-3.8-flash", architecture: { output_modalities: ["text"] }, pricing: { prompt: ".000000825", completion: ".000004125", image: ".000000825", audio: ".000000825", web_search: ".014", input_cache_write: ".0000000416666666666667", internal_reasoning: ".000004125" } }] }); };
 try {
  const text = await quoteAutomaticCredits({ feature: "story_generation", model: "openrouter/google/gemini-3.8-flash", quantity: 1 }); assert.equal(text.credits, 12);
  const video = settings => quoteAutomaticCredits({ feature: "image_to_video", model: "openrouter/google/veo-3.1", quantity: settings.seconds * settings.outputs, unit: "second:" + settings.quality, settings });
  const standard = await video({ seconds: 8, outputs: 1, quality: "720p" }); assert.equal(standard.estimatedCostUsd, 3.2); assert.equal(standard.credits, 550);
  const multiple = await video({ seconds: 8, outputs: 2, quality: "720p" }); assert.equal(multiple.estimatedCostUsd, 6.4); assert.ok(multiple.credits >= standard.credits * 2 - 1);
  assert.equal((await video({ seconds: 8, outputs: 1, quality: "4K" })).estimatedCostUsd, 4.8); assert.equal(calls, 2);
 } finally { globalThis.fetch = saved; }
});
test("expired verified cost overrides never silently price an unknown model", async () => {
 await PricingOverride.updateMany({ model: "openrouter/test/verified" }, { expiresAt: new Date(0) });
 const saved = globalThis.fetch; globalThis.fetch = async () => Response.json({ data: [] });
 try { await assert.rejects(() => quoteAutomaticCredits({ feature: "text_to_image", model: "openrouter/test/verified", unit: "image:1K", quantity: 1 }), /not verified/); } finally { globalThis.fetch = saved; }
});
test("management reporting uses separate keys, caches, deduplicates and preserves stale data", async () => {
 env.OPENROUTER_MANAGEMENT_KEY = "management-test"; env.OPENROUTER_API_KEY = "generation-test"; let calls = 0, fail = false;
 globalThis.fetch = async (url, options) => { calls++; const path = new URL(url).pathname; assert.equal(options.method, undefined); assert.equal(options.headers.Authorization, path.endsWith("/key") ? "Bearer generation-test" : "Bearer management-test"); if (fail) return Response.json({}, { status: 503 }); return Response.json({ data: path.endsWith("/credits") ? { total_credits: 20, total_usage: 3 } : path.endsWith("/key") ? { limit_remaining: 9, usage_daily: .5, label: "private key label" } : [{ date: "2026-10-15", model: "test", provider_name: "provider", requests: 2, usage: .2 }] }); };
 try {
  const balance = await syncProviderRecord("balance"); assert.equal(balance.values.remainingUsd, 17); await syncProviderRecord("balance"); assert.equal(calls, 1);
  const key = await syncProviderRecord("key"); assert.equal(key.values.label, undefined); await syncProviderRecord("activity"); await ProviderSnapshot.updateOne({ _id: "activity" }, { attemptedAt: new Date(0) }); await syncProviderRecord("activity"); assert.equal(await ProviderActivity.countDocuments(), 1);
  fail = true; await ProviderSnapshot.updateOne({ _id: "balance" }, { attemptedAt: new Date(0) }); const stale = await syncProviderRecord("balance"); assert.equal(stale.values.remainingUsd, 17); assert.match(stale.error, /service error/);
 } finally { globalThis.fetch = realFetch; }
});
test("daily admission is atomic, idempotent and failed admission rolls back wallet changes", async () => {
 env.OPENROUTER_MANAGEMENT_KEY = undefined; env.OPENROUTER_API_KEY = undefined; await ProviderSnapshot.deleteMany({});
 await PricingPolicy.updateOne({ _id: "global" }, { "values.userDailyUsd": .1, "values.globalDailyUsd": 1 });
 await Wallet.create({ userId: user._id, availableCredits: 100 });
 const quote = { credits: 10, provider: "openrouter", estimatedCostUsd: .06 };
 const reservation = await reserveCredits(String(user._id), quote, "daily-one"); assert.equal((await reserveCredits(String(user._id), quote, "daily-one")).id, reservation.id);
 await assert.rejects(() => reserveCredits(String(user._id), quote, "daily-two"), /Daily generation/); assert.equal((await Wallet.findOne({ userId: user._id })).availableCredits, 90);
 assert.equal((await DailySpendBudget.findById("global:" + new Date().toISOString().slice(0, 10))).admittedUsd, .06);
 await releaseReservation(reservation.id); assert.equal((await Wallet.findOne({ userId: user._id })).availableCredits, 100);
});
test("Redis failure persists image and video work for bounded Mongo fallback", async () => {
 const image = await ImageGenerationJob.create({ userId: user._id, prompt: "Original scene", model: "test", status: "queued" });
 const video = await VideoGenerationJob.create({ userId: user._id, motionPrompt: "Camera movement", model: "test", status: "queued" });
 const offline = { ready: async () => { throw new Error("Redis offline"); }, enqueue: async () => { throw new Error("Must not enqueue"); } };
 assert.equal(await dispatchGeneration("image", image.id, offline), "mongo"); assert.equal(await dispatchGeneration("video", video.id, offline), "mongo");
 let executions = 0;
 const processor = Model => async id => { const claimed = await Model.findOneAndUpdate({ _id: id, status: "queued" }, { status: "processing" }); if (!claimed) return; executions++; await Model.updateOne({ _id: id }, { status: "completed" }); };
 const processors = { image: processor(ImageGenerationJob), video: processor(VideoGenerationJob) };
 await Promise.all([runMongoGenerationTick(processors), runMongoGenerationTick(processors)]); await runMongoGenerationTick(processors);
 assert.equal(executions, 2); assert.equal((await ImageGenerationJob.findById(image._id)).status, "completed"); assert.equal((await VideoGenerationJob.findById(video._id)).status, "completed");
 const delivered = await ImageGenerationJob.create({ userId: user._id, prompt: "Next image", model: "test", status: "queued" });
 assert.equal(await dispatchGeneration("image", delivered.id, { ready: async () => {}, enqueue: async () => { throw new Error("Disconnected after readiness"); } }), "mongo");
});

test("verified actual costs release unused new quote ceilings exactly once and preserve legacy terms", async () => {
 await PricingPolicy.updateOne({ _id: "global" }, { "values.userDailyUsd": 50, "values.globalDailyUsd": 200 });
 const id = new mongoose.Types.ObjectId(); await Wallet.create({ userId: id, availableCredits: 1000 });
 const terms = { credits: 20, provider: "openrouter", model: "openrouter/test/actual", feature: "story_generation", estimatedCostUsd: .1, assumptions: defaultPricingPolicy, creditUsd: ".018", quantity: 1 };
 const reserve = await reserveCredits(String(id), terms, "actual-fixture");
 await GatewayUsage.create({ reservationId: reserve._id, userId: id, model: terms.model, kind: "text", requestId: "actual-fixture-request", status: "completed", costUsd: .002 });
 await settleReservation(String(reserve._id)); await settleReservation(String(reserve._id));
 const wallet = await Wallet.findOne({ userId: id }); assert.equal(wallet.availableCredits, 999); assert.equal(wallet.spentCredits, 1); assert.equal(wallet.reservedCredits, 0);
 assert.equal(await LedgerEntry.countDocuments({ idempotencyKey: "actual-cost-release:" + reserve._id }), 1);
 const legacy = await reserveCredits(String(id), { credits: 20, feature: "legacy", provider: "openrouter", estimatedCostUsd: .1 }, "legacy-fixture");
 await settleReservation(String(legacy._id), .002); assert.equal((await CreditReservation.findById(legacy._id)).credits, 20);
 const unknown = await reserveCredits(String(id), terms, "unknown-fixture");
 await GatewayUsage.create({ reservationId: unknown._id, userId: id, model: terms.model, kind: "text", status: "completed" });
 await settleReservation(String(unknown._id)); const unverified = await CreditReservation.findById(unknown._id); assert.equal(unverified.credits, 20); assert.equal(unverified.providerCostUsd, undefined);
});
