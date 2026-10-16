import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import argon2 from "argon2";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { adminRouter } from "../dist/routes/admin.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { AdminBootstrap, AdminSession, AdminAudit, ApprovedQuote, PlatformControl, ProviderControl, ProviderDaily } from "../dist/models/Admin.js";
import { CreditPackage } from "../dist/models/CreditPackage.js";
import { GenerationPriceRule } from "../dist/models/GenerationPriceRule.js";
import { Wallet } from "../dist/models/Wallet.js";
import { Payment } from "../dist/models/Payment.js";
import { CreditReservation } from "../dist/models/CreditReservation.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { ImageGenerationJob } from "../dist/models/ImageGenerationJob.js";
import { VideoExport } from "../dist/models/VideoEdit.js";
import { bootstrapAdmin, totp } from "../dist/services/adminSecurity.js";
import { platformGate, withProvider, assertProviderBudget } from "../dist/services/platformControl.js";
import { managedPrice, rememberQuote, approvedTerms } from "../dist/services/managedPricing.js";
import { reserveCredits, settleReservation, releaseReservation } from "../dist/services/wallet.js";
import { csv } from "../dist/services/adminReports.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { env } from "../dist/config/env.js";
let db, server, base, headers, customer, admin, pkg;
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }], binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("drex_phase13"));
  for (const m of [User, AdminBootstrap, AdminSession, AdminAudit, Wallet, LedgerEntry, CreditReservation, CreditPackage, ApprovedQuote, ProviderDaily]) await m.init();
  env.ADMIN_LOGIN_METHOD = "totp"; env.ADMIN_BOOTSTRAP_ENABLED = true; env.ADMIN_BOOTSTRAP_EMAIL = "initial-admin@example.test"; env.ADMIN_BOOTSTRAP_PASSWORD_HASH = await argon2.hash("AdminTestPassword123"); env.ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
  await bootstrapAdmin(); admin = await User.findOne({ role: "admin" });
  customer = await User.create({ displayName: "Customer", email: "customer@example.test", passwordHash: "test", status: "active", lastLoginAt: new Date() });
  await Wallet.create({ userId: customer._id, availableCredits: 100, reservedCredits: 0 });
  await Session.create({ userId: customer._id, tokenHash: hashSecret("normal-session"), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
  const app = express(); app.use(express.json(), cookieParser()); app.use("/api", platformGate); app.use("/api/admin", adminRouter); app.get("/api/images/config", (_req, res) => res.json({ ok: true })); app.post("/api/auth/register", (_req, res) => res.json({ ok: true })); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db?.stop(); });
async function request(path, body, method = "GET", custom = headers) { const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...custom }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json(), response: r }; }
test("one-time bootstrap uses only a password hash and refuses repeat provisioning", async () => {
  assert.ok(admin); assert.notEqual(admin.passwordHash, "AdminTestPassword123"); assert.ok(await argon2.verify(admin.passwordHash, "AdminTestPassword123")); await bootstrapAdmin(); assert.equal(await User.countDocuments({ role: "admin" }), 1); assert.ok(await AdminBootstrap.findById("initial-admin"));
});
test("admin session requires password and TOTP; ordinary sessions cannot authorize admin APIs", async () => {
  assert.equal((await request("/api/admin/me", null, "GET", { Cookie: "drex_session=normal-session" })).status, 401);
  assert.equal((await request("/api/admin/login", { email: admin.email, password: "wrong", code: "000000" }, "POST", {})).status, 401);
  const loginCode = totp(env.ADMIN_TOTP_SECRET);
  const login = await request("/api/admin/login", { email: admin.email, password: "AdminTestPassword123", code: loginCode }, "POST", {}); assert.equal(login.status, 200);
  const cookies = login.response.headers.getSetCookie(); const session = cookies.find(s => s.startsWith("drex_admin=")); assert.match(session, /HttpOnly/); assert.match(session, /SameSite=Strict/); headers = { Cookie: session.split(";")[0], "x-admin-csrf": login.data.csrf };
  assert.equal((await request("/api/admin/me")).status, 200); assert.ok(!JSON.stringify(login.data).includes("passwordHash"));
  const replay = await request("/api/admin/login", { email: admin.email, password: "AdminTestPassword123", code: loginCode }, "POST", {}); assert.equal(replay.status, 401);
});
test("packages and pricing changes require CSRF, are audited and update real records", async () => {
  const body = { key: "starter", name: "Starter", credits: 1000, amount: 15, currency: "USD", active: true, sortOrder: 1, promotion: "", reason: "Initial verified package configuration" };
  assert.equal((await request("/api/admin/packages", body, "POST", { ...headers, "x-admin-csrf": "wrong" })).status, 403);
  assert.equal((await request("/api/admin/packages", body, "POST")).status, 200); pkg = await CreditPackage.findOne({ key: "starter" });
  const price = { feature: "text_to_image", provider: "gemini", model: "test-image", unit: "image:1K", providerCostUsd: .01, desiredMarginPct: 20, creditsPerUnit: 2, active: true, reason: "Configure measured image pricing estimate" };
  assert.equal((await request("/api/admin/pricing", price, "POST")).status, 201); assert.ok(await AdminAudit.findOne({ action: "pricing-version" }));
  const settings = { model: "test-image", resolution: "1K", numberOfImages: 2 }; const quote = await managedPrice("text_to_image", "gemini", settings, 10); assert.equal(quote.credits, 4); await rememberQuote(customer._id, settings, quote);
  await request("/api/admin/pricing", { ...price, creditsPerUnit: 4 }, "POST"); const retained = await approvedTerms(customer._id, { ...settings, approvedCredits: 4 }, 4, () => managedPrice("text_to_image", "gemini", settings, 10)); assert.equal(retained.credits, 4); assert.equal((await managedPrice("text_to_image", "gemini", settings, 10)).credits, 8);
});
test("documented wallet adjustments are transactional, idempotent and cannot make balance negative", async () => {
  const body = { credits: 20, reason: "Customer service documented goodwill adjustment", requestId: randomUUID() }; assert.equal((await request(`/api/admin/users/${customer._id}/adjust`, body, "POST")).status, 200); await request(`/api/admin/users/${customer._id}/adjust`, body, "POST"); assert.equal((await Wallet.findOne({ userId: customer._id })).availableCredits, 120); assert.equal(await LedgerEntry.countDocuments({ type: "adjustment" }), 1);
  assert.equal((await request(`/api/admin/users/${customer._id}/adjust`, { ...body, credits: -1000, requestId: randomUUID() }, "POST")).status, 500); assert.equal((await Wallet.findOne({ userId: customer._id })).availableCredits, 120);
});
test("user restriction and suspension block generation and revoke ordinary sessions", async () => {
  assert.equal((await request(`/api/admin/users/${customer._id}`, { aiRestricted: true, reason: "Restrict generation during account review" }, "PATCH")).status, 200);
  await assert.rejects(reserveCredits(String(customer._id), { credits: 1 }, "blocked"), /restricted/);
  await request(`/api/admin/users/${customer._id}`, { aiRestricted: false, status: "suspended", reason: "Suspend during an authenticated security review" }, "PATCH"); assert.ok((await Session.findOne({ userId: customer._id })).revokedAt);
  await request(`/api/admin/users/${customer._id}`, { status: "active", reason: "Restore after completing security review" }, "PATCH");
  const detail = await request(`/api/admin/users/${customer._id}`); assert.equal(detail.data.user.status, "active"); assert.ok(Array.isArray(detail.data.payments)); assert.ok(Array.isArray(detail.data.jobs)); assert.ok(!JSON.stringify(detail.data).includes("passwordHash"));
});
test("feature gates reject direct API calls and maintenance permits only authenticated admins", async () => {
  const body = { maintenance: false, message: "We are performing scheduled maintenance.", features: { research: true, assistant: true, images: false, videos: true, voice: true, studio: true, publishing: true, registrations: false }, reason: "Temporarily pause image generation and registrations" };
  assert.equal((await request("/api/admin/controls", body, "PUT")).status, 200); assert.equal((await request("/api/images/config", null, "GET", {})).status, 403); assert.equal((await request("/api/auth/register", {}, "POST", {})).status, 403);
  await request("/api/admin/controls", { ...body, maintenance: true }, "PUT"); assert.equal((await request("/api/images/config", null, "GET", {})).status, 503); assert.equal((await request("/api/images/config")).status, 200);
  assert.equal((await request("/api/admin/me")).status, 200); await request("/api/admin/controls", { ...body, maintenance: false, features: { ...body.features, images: true, registrations: true } }, "PUT");
});
test("provider controls enforce disable, concurrency, daily usage and spending limits", async () => {
  const policy = { provider: "gemini", model: "test-image", enabled: true, defaultFor: "", maxConcurrent: 1, maxDailyJobs: 2, maxJobCostUsd: 1, reason: "Apply conservative test provider limits" };
  assert.equal((await request("/api/admin/providers", policy, "PUT")).status, 200);
  await assertProviderBudget("test-image", .2); await assert.rejects(assertProviderBudget("test-image", 2), /spending/); await assert.rejects(assertProviderBudget("test-image", null), /spending/);
  let release; const gate = new Promise(r => release = r); const running = withProvider("test-image", async () => { await gate; return true; });
  // Wait for durable admission, then prove another call cannot enter.
  for (let i = 0; i < 100; i++) { if (await ProviderDaily.exists({ _id: `test-image:${new Date().toISOString().slice(0, 10)}` })) break; await new Promise(r => setTimeout(r, 10)); }
  await assert.rejects(withProvider("test-image", async () => true), /concurrency/); release(); assert.equal(await running, true); await withProvider("test-image", async () => true); await assert.rejects(withProvider("test-image", async () => true), /daily/);
  await request("/api/admin/providers", { ...policy, enabled: false }, "PUT"); await assert.rejects(withProvider("test-image", async () => true), /disabled/);
  await ProviderControl.deleteMany({});
});
test("safe queued cancellation releases exactly once and cannot later settle a released reservation", async () => {
  const reserve = await reserveCredits(String(customer._id), { credits: 10, feature: "text_to_image", provider: "gemini", model: "test-image", estimatedCostUsd: .02 }, `cancel:${randomUUID()}`);
  const job = await ImageGenerationJob.create({ userId: customer._id, model: "test-image", prompt: "Test image", status: "queued", reservationId: reserve._id, approvedCredits: 10 });
  assert.equal((await request(`/api/admin/jobs/image/${job._id}/control`, { action: "cancel", reason: "User request confirmed by support conversation" }, "POST")).status, 200);
  assert.equal((await CreditReservation.findById(reserve._id)).status, "released"); const balance = (await Wallet.findOne({ userId: customer._id })).availableCredits;
  await settleReservation(String(reserve._id)); await releaseReservation(String(reserve._id)); assert.equal((await Wallet.findOne({ userId: customer._id })).availableCredits, balance);
  assert.equal((await request(`/api/admin/jobs/image/${job._id}/control`, { action: "retry", reason: "Try unsafe replay of billable provider request" }, "POST")).status, 409);
  const render = await VideoExport.create({ userId: customer._id, projectId: new mongoose.Types.ObjectId(), editId: new mongoose.Types.ObjectId(), revision: 0, settings: {}, timeline: {}, status: "failed", attempts: 3 }); assert.equal((await request(`/api/admin/jobs/rendering/${render._id}/control`, { action: "retry", reason: "Retry safe FFmpeg render after worker recovery" }, "POST")).status, 200); assert.equal((await VideoExport.findById(render._id)).status, "queued");
});
test("financial reporting uses actual database records, keeps currencies distinct and exports safe CSV", async () => {
  await Payment.create({ userId: customer._id, packageId: pkg._id, txRef: "usd-sale", status: "successful", amount: 15, currency: "USD", credits: 1000 }); await Payment.create({ userId: customer._id, packageId: pkg._id, txRef: "ngn-sale", status: "successful", amount: 10000, currency: "NGN", credits: 1000 }); await Payment.create({ userId: customer._id, packageId: pkg._id, txRef: "failed-sale", status: "failed", amount: 99, currency: "USD", credits: 1000 });
  const day = new Date().toISOString().slice(0, 10), result = await request(`/api/admin/overview?start=${day}&end=${day}`); assert.equal(result.status, 200); assert.equal(result.data.revenue.USD, 15); assert.equal(result.data.revenue.NGN, 10000); assert.equal(result.data.verifiedExpenses, null); assert.ok(result.data.costCoverage.unknownReservations >= 0);
  const exportResponse = await fetch(base + "/api/admin/reports/payments?csv=true", { headers }); assert.equal(exportResponse.status, 200); assert.match(exportResponse.headers.get("content-type"), /text\/csv/); assert.ok((await exportResponse.text()).includes("usd-sale")); assert.ok(csv([{ value: "=danger()" }], ["value"]).includes("'=danger()"));
});
test("admin support routes reuse real authorization and logout revokes access", async () => {
  assert.equal((await request("/api/admin/support/config")).data.staff, true); assert.equal((await request("/api/admin/feedback/admin")).status, 200);
  await request("/api/admin/logout", {}, "POST"); assert.equal((await request("/api/admin/me")).status, 401);
});
