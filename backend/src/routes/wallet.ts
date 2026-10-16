import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { CreditPackage } from "../models/CreditPackage.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { Payment } from "../models/Payment.js";
import { Wallet } from "../models/Wallet.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { createCheckout, verifyTransaction, verifyWebhookHash } from "../services/flutterwave.js";
import { creditPurchase, createQuote, ensureWallet } from "../services/wallet.js";
import { randomToken } from "../utils/crypto.js";

export const walletRouter = Router();

walletRouter.get("/packages", async (_req, res) => {
  const packages = await CreditPackage.find({ active: true }).sort({ sortOrder: 1 });
  res.json({ packages });
});

walletRouter.post("/flutterwave/webhook", async (req, res, next) => {
  try {
    if (!verifyWebhookHash(req.get("verif-hash") ?? undefined)) return res.status(401).json({ error: "Invalid webhook signature" });
    const txId = req.body?.data?.id;
    const txRef = req.body?.data?.tx_ref;
    if (!txId || !txRef) return res.status(202).json({ received: true });
    const payment = await Payment.findOne({ txRef });
    if (!payment) return res.status(202).json({ received: true });
    payment.audit.push({ event: "webhook_received", details: req.body });
    await payment.save();
    const tx = await verifyTransaction(txId);
    await finalizePayment(payment, tx);
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

walletRouter.use(requireAuth);

walletRouter.get("/", async (req, res) => {
  const wallet = await ensureWallet(String(req.user._id));
  const [ledger, payments, packages] = await Promise.all([
    LedgerEntry.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50),
    Payment.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50),
    CreditPackage.find({ active: true }).sort({ sortOrder: 1 })
  ]);
  res.json({ wallet, ledger, payments, packages });
});

walletRouter.post("/payments/initiate", requireCsrf, async (req, res, next) => {
  try {
    const { packageId } = z.object({ packageId: z.string() }).parse(req.body);
    const pkg = await CreditPackage.findById(packageId);
    if (!pkg || !pkg.active) return res.status(404).json({ error: "Credit package is not available" });
    if (pkg.currency !== env.PAYMENT_CURRENCY) return res.status(400).json({ error: "Unsupported payment currency for current checkout configuration" });
    const txRef = `drex_${Date.now()}_${randomToken(6)}`;
    const payment = await Payment.create({ userId: req.user._id, packageId: pkg._id, txRef, amount: pkg.amount, currency: pkg.currency, credits: pkg.credits, status: "pending", audit: [{ event: "initiated", details: { packageId } }] });
    const checkout = await createCheckout({
      tx_ref: txRef,
      amount: pkg.amount,
      currency: pkg.currency,
      redirect_url: `${env.APP_URL}/dashboard/credit-wallet?tx_ref=${txRef}`,
      customer: { email: req.user.email, name: req.user.displayName },
      customizations: { title: "Drex Credits", description: `${pkg.credits} credits`, logo: `${env.APP_URL}/drex-logo.svg` }
    });
    payment.checkoutUrl = checkout.link;
    await payment.save();
    res.json({ checkoutUrl: checkout.link, payment });
  } catch (error) {
    next(error);
  }
});

walletRouter.post("/payments/verify", requireCsrf, async (req, res, next) => {
  try {
    const { transactionId, txRef } = z.object({ transactionId: z.union([z.string(), z.number()]).optional(), txRef: z.string() }).parse(req.body);
    const payment = await Payment.findOne({ txRef, userId: req.user._id });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (!transactionId) return res.json({ payment });
    const tx = await verifyTransaction(transactionId);
    await finalizePayment(payment, tx);
    res.json({ payment: await Payment.findById(payment._id), wallet: await Wallet.findOne({ userId: req.user._id }) });
  } catch (error) {
    next(error);
  }
});

walletRouter.post("/quote", requireCsrf, async (req, res, next) => {
  try {
    res.json({ quote: await createQuote(req.body) });
  } catch (error) {
    next(error);
  }
});

// Only authorized generation services may mutate reserves after validating their own job state.
walletRouter.post(["/reservations", "/reservations/:id/settle", "/reservations/:id/release"], requireCsrf, (_req, res) => {
  res.status(403).json({ error: "Reservations are managed by generation services. Use the production controls to cancel pending work." });
});

async function finalizePayment(payment: any, tx: any) {
  if (payment.status === "successful") {
    await creditPurchase({ userId: String(payment.userId), credits: payment.credits, idempotencyKey: 'payment:' + payment.txRef, metadata: { paymentId: payment._id } });
    return;
  }
  const valid = tx.status === "successful" && tx.tx_ref === payment.txRef && tx.currency === payment.currency && Number(tx.amount) >= payment.amount;
  payment.flutterwaveId = String(tx.id ?? payment.flutterwaveId ?? "");
  payment.receipt = tx;
  payment.audit.push({ event: valid ? "verified_success" : "verified_rejected", details: tx });
  if (!valid) {
    payment.status = "rejected";
    await payment.save();
    return;
  }
  await creditPurchase({ userId: String(payment.userId), credits: payment.credits, idempotencyKey: `payment:${payment.txRef}`, metadata: { paymentId: payment._id, tx } });
  payment.status = "successful";
  await payment.save();
}
