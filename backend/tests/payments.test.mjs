import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { walletRouter } from "../dist/routes/wallet.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { env } from "../dist/config/env.js";
import { Payment } from "../dist/models/Payment.js";
import { Wallet } from "../dist/models/Wallet.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
let db, server, base, owner, pkg, current, providerCalls = 0;
const originalFetch = globalThis.fetch;
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }], binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
  await mongoose.connect(db.getUri("drex_payments"));
  for (const model of [Payment, Wallet, LedgerEntry]) await model.init();
  owner = new mongoose.Types.ObjectId(); pkg = new mongoose.Types.ObjectId();
  env.FLUTTERWAVE_MODE = "test"; env.FLW_SECRET_KEY = "FLWSECK_TEST-fixture"; env.FLW_PUBLIC_KEY = "FLWPUBK_TEST-fixture"; env.FLW_WEBHOOK_HASH = "test-webhook-secret";
  globalThis.fetch = async (url, options) => { if (String(url).startsWith("https://api.flutterwave.com/")) { providerCalls++; return new Response(JSON.stringify({ status: "success", data: current }), { status: 200 }); } return originalFetch(url, options); };
  const app = express(); app.use(express.json()); app.use("/api/wallet", walletRouter); app.use(errorHandler);
  server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { globalThis.fetch = originalFetch; server?.closeAllConnections(); if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await db?.stop(); });
async function webhook(reference, signature = env.FLW_WEBHOOK_HASH) { return fetch(base + "/api/wallet/flutterwave/webhook", { method: "POST", headers: { "Content-Type": "application/json", "verif-hash": signature }, body: JSON.stringify({ data: { id: 123, tx_ref: reference } }) }); }
test("untrusted webhook cannot verify or credit a payment", async () => { const before = providerCalls; assert.equal((await webhook("bad", "wrong")).status, 401); assert.equal(providerCalls, before); assert.equal(await LedgerEntry.countDocuments(), 0); });
test("verified test payment credits once, preserves the purchase snapshot and appears successful", async () => {
  const payment = await Payment.create({ userId: owner, packageId: pkg, txRef: "purchase-good", amount: 15, currency: "USD", credits: 1000 });
  current = { id: 123, status: "successful", tx_ref: payment.txRef, amount: 15, currency: "USD" };
  assert.equal((await webhook(payment.txRef)).status, 200); assert.equal((await webhook(payment.txRef)).status, 200);
  assert.equal((await Wallet.findOne({ userId: owner })).availableCredits, 1000); assert.equal(await LedgerEntry.countDocuments({ idempotencyKey: "payment:" + payment.txRef }), 1);
  assert.equal((await Payment.findById(payment._id)).status, "successful");
});
test("amount and currency mismatches do not issue credits", async () => {
  const payment = await Payment.create({ userId: owner, packageId: pkg, txRef: "purchase-invalid", amount: 15, currency: "USD", credits: 1000 });
  current = { id: 123, status: "successful", tx_ref: payment.txRef, amount: 1, currency: "NGN" };
  assert.equal((await webhook(payment.txRef)).status, 200); assert.equal((await Payment.findById(payment._id)).status, "rejected"); assert.equal((await Wallet.findOne({ userId: owner })).availableCredits, 1000);
});
test("webhook retry recovers a legacy successful payment missing its purchase ledger entry", async () => {
  const payment = await Payment.create({ userId: owner, packageId: pkg, txRef: "purchase-recovery", amount: 15, currency: "USD", credits: 1000, status: "successful" });
  current = { id: 456, status: "successful", tx_ref: payment.txRef, amount: 15, currency: "USD" };
  assert.equal((await webhook(payment.txRef)).status, 200); assert.equal((await webhook(payment.txRef)).status, 200); assert.equal((await Wallet.findOne({ userId: owner })).availableCredits, 2000); assert.equal(await LedgerEntry.countDocuments({ idempotencyKey: "payment:" + payment.txRef }), 1);
});
