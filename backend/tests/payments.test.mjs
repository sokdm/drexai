import {requestProtection} from '../dist/middleware/requestProtection.js';
import cookieParser from 'cookie-parser';import {User} from '../dist/models/User.js';import {Session} from '../dist/models/Session.js';import {hashSecret} from '../dist/utils/crypto.js';
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
  const user=await User.create({email:"checkout-security@example.test",displayName:"Checkout tester",passwordHash:"fixture",status:"active"});owner=user._id;await Session.create({userId:owner,tokenHash:hashSecret("checkout-test"),csrfTokenHash:hashSecret("csrf"),expiresAt:new Date(Date.now()+3600000)});pkg = new mongoose.Types.ObjectId();
  env.FLUTTERWAVE_MODE = "test"; env.FLW_SECRET_KEY = "FLWSECK_TEST-fixture"; env.FLW_PUBLIC_KEY = "FLWPUBK_TEST-fixture"; env.FLW_WEBHOOK_HASH = "test-webhook-secret";
  globalThis.fetch = async (url, options) => { if (String(url).startsWith("https://api.flutterwave.com/")) { providerCalls++; return new Response(JSON.stringify({ status: "success", data: current }), { status: 200 }); } return originalFetch(url, options); };
  const app = express(); app.use(express.json(),cookieParser()); app.use(requestProtection); app.use("/api/wallet", walletRouter); app.use(errorHandler);
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

async function cancel(txRef,csrf=true){return fetch(base+'/api/wallet/payments/cancel',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'drex_session=checkout-test',...(csrf?{'x-csrf-token':'csrf'}:{})},body:JSON.stringify({txRef})});}
test('owned pending checkout cancellation is CSRF protected, idempotent and does not credit the wallet',async()=>{const p=await Payment.create({userId:owner,packageId:pkg,txRef:'cancel-owned',amount:12,currency:'USD',credits:500});const before=(await Wallet.findOne({userId:owner})).availableCredits;assert.equal((await cancel(p.txRef,false)).status,403);assert.equal((await cancel(p.txRef)).status,200);assert.equal((await cancel(p.txRef)).status,200);const saved=await Payment.findById(p._id);assert.equal(saved.status,'cancelled');assert.equal(saved.audit.filter(e=>e.event==='checkout_cancel_requested').length,1);assert.equal((await Wallet.findOne({userId:owner})).availableCredits,before);const other=await Payment.create({userId:new mongoose.Types.ObjectId(),packageId:pkg,txRef:'cancel-foreign',amount:12,currency:'USD',credits:500});assert.equal((await cancel(other.txRef)).status,404);assert.equal((await Payment.findById(other._id)).status,'pending');});
test('late failed or cancelled callbacks cannot downgrade a verified successful payment',async()=>{const p=await Payment.findOne({txRef:'purchase-good'});const before=(await Wallet.findOne({userId:owner})).availableCredits;current={id:123,status:'failed',tx_ref:p.txRef,amount:15,currency:'USD'};assert.equal((await webhook(p.txRef)).status,200);assert.equal((await Payment.findById(p._id)).status,'successful');await cancel(p.txRef);assert.equal((await Payment.findById(p._id)).status,'successful');assert.equal((await Wallet.findOne({userId:owner})).availableCredits,before);});
test('provider-verified failed attempts never issue purchase credits',async()=>{const p=await Payment.create({userId:owner,packageId:pkg,txRef:'actual-failure',amount:12,currency:'USD',credits:500});const before=(await Wallet.findOne({userId:owner})).availableCredits;current={id:777,status:'failed',tx_ref:p.txRef,amount:12,currency:'USD'};assert.equal((await webhook(p.txRef)).status,200);assert.equal((await Payment.findById(p._id)).status,'failed');assert.equal((await Wallet.findOne({userId:owner})).availableCredits,before);});

test('a cancellation hint cannot hide an actual verified payment; late success credits once',async()=>{const p=await Payment.findOne({txRef:'cancel-owned'});const before=(await Wallet.findOne({userId:owner})).availableCredits;current={id:778,status:'pending',tx_ref:p.txRef,amount:12,currency:'USD'};await webhook(p.txRef);assert.equal((await Payment.findById(p._id)).status,'cancelled');current={id:778,status:'successful',tx_ref:p.txRef,amount:12,currency:'USD'};await webhook(p.txRef);await webhook(p.txRef);assert.equal((await Payment.findById(p._id)).status,'successful');assert.equal((await Wallet.findOne({userId:owner})).availableCredits,before+500);assert.equal(await LedgerEntry.countDocuments({idempotencyKey:'payment:'+p.txRef}),1);});
