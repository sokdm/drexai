import { checkGenerationUser, assertProviderBudget } from "./platformControl.js";
import { ProviderControl } from "../models/Admin.js";
import mongoose from "mongoose";
import { CreditPackage } from "../models/CreditPackage.js";
import { CreditReservation } from "../models/CreditReservation.js";
import { GenerationPriceRule } from "../models/GenerationPriceRule.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { Wallet } from "../models/Wallet.js";

export async function seedCreditConfig() {
  await CreditPackage.updateOne({ key: "starter" }, { $setOnInsert: { key: "starter", name: "Starter", credits: 1000, amount: 15, currency: "USD", sortOrder: 1, active: true } }, { upsert: true });
  await CreditPackage.updateOne({ key: "creator" }, { $setOnInsert: { key: "creator", name: "Creator", credits: 5000, amount: 50, currency: "USD", sortOrder: 2, active: true } }, { upsert: true });
  const rules = [
    ["ai_research_chat", "gemini", "gemini-3.8-flash", "request"],
    ["publishing_optimization", "gemini", "gemini-3.8-flash", "request"],
    ["ai_channel_analysis", "gemini", "gemini-3.8-flash", "request"],
    ["story_generation", "gemini", "gemini-3.8-flash", "project"],
    ["text_to_image", "openai", "pending-cost-verification", "image"],
    ["image_to_video", "pending", "pending-cost-verification", "second"],
    ["voice_generation", "pending", "pending-cost-verification", "character"],
    ["ai_studio_production", "pending", "pending-cost-verification", "scene"],
    ["final_rendering", "pending", "pending-cost-verification", "minute"]
  ];
  for (const [feature, provider, model, unit] of rules) {
    const active = provider === "gemini";
    await GenerationPriceRule.updateOne({ feature, provider, model }, { $setOnInsert: { feature, provider, model, unit, providerCostUsd: 0, desiredMarginPct: 50, creditsPerUnit: active ? 1 : 0, active, notes: active ? "Phase 5 configurable Gemini rate. Admin UI can adjust later." : "Disabled until provider costs and settlement currency support are verified." } }, { upsert: true });
  }
}

export async function ensureWallet(userId: string, session?: mongoose.ClientSession) {
  const existing = await Wallet.findOne({ userId }).session(session ?? null);
  if (existing) return existing;
  const [wallet] = await Wallet.create([{ userId }], { session });
  return wallet;
}

export async function creditPurchase({ userId, credits, idempotencyKey, metadata }: { userId: string; credits: number; idempotencyKey: string; metadata: Record<string, unknown> }) {
  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    const existing = await LedgerEntry.findOne({ idempotencyKey }).session(session);
    if (existing) return;
    const wallet = await ensureWallet(userId, session);
    wallet.availableCredits += credits;
    wallet.purchasedCredits += credits;
    await wallet.save({ session });
    await LedgerEntry.create([{ userId, walletId: wallet._id, type: "purchase", amountCredits: credits, balanceAfter: wallet.availableCredits, idempotencyKey, metadata }], { session });
  });
  await session.endSession();
}

export async function createQuote(input: any) {
  const rule = await GenerationPriceRule.findOne({ feature: input.feature, provider: input.provider, model: input.model, active: true, ...(input.unit ? { unit: input.unit } : {}), ...(input.ruleId ? { _id: input.ruleId } : {}) });
  if (!rule) return { allowed: false, credits: 0, reason: "Pricing is not active until provider costs are verified." };
  const quantity = Math.max(1, Number(input.quantity ?? 1));
  const credits = Math.ceil(rule.creditsPerUnit * quantity);
  return { allowed: true, credits, feature: input.feature, provider: input.provider, model: input.model, estimatedCostUsd: rule.providerCostUsd > 0 ? rule.providerCostUsd * quantity : null, ruleId: rule._id, quantity, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
}

export async function reserveCredits(userId: string, quote: any, idempotencyKey: string, outerSession?: mongoose.ClientSession): Promise<any> {
  await checkGenerationUser(userId);
  if (quote.model) await assertProviderBudget(quote.model, quote.estimatedCostUsd);
  const control = quote.model ? await ProviderControl.findOne({ model: quote.model }) : null;
  if (control && (!control.enabled || typeof quote.estimatedCostUsd !== "number" || quote.estimatedCostUsd > control.maxJobCostUsd)) throw new Error("Provider is disabled or the job spending cap cannot be satisfied.");
  if (!Number.isSafeInteger(quote.credits) || quote.credits < 0) throw new Error("Invalid credit amount");
  const session = outerSession ?? await mongoose.startSession();
  let reservation;
  const reserve = async () => {
    const existing = await CreditReservation.findOne({ idempotencyKey }).session(session);
    if (existing) {
      if (String(existing.userId) !== userId) throw new Error("Reservation ownership mismatch");
      reservation = existing; return;
    }
    const wallet = await ensureWallet(userId, session);
    if (wallet.availableCredits < quote.credits) throw new Error("Insufficient credits");
    wallet.availableCredits -= quote.credits;
    wallet.reservedCredits += quote.credits;
    await wallet.save({ session });
    const [created] = await CreditReservation.create([{ userId, quote, credits: quote.credits, status: "reserved", idempotencyKey, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }], { session });
    reservation = created;
    await LedgerEntry.create([{ userId, walletId: wallet._id, type: "reservation", amountCredits: -quote.credits, balanceAfter: wallet.availableCredits, idempotencyKey: `ledger:${idempotencyKey}`, metadata: { reservationId: created._id } }], { session });
  };
  try {
    if (outerSession) await reserve();
    else await session.withTransaction(reserve);
  } finally { if (!outerSession) await session.endSession(); }
  return reservation;
}

export async function settleReservation(reservationId: string, providerCostUsd = 0) {
  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    const reservation = await CreditReservation.findById(reservationId).session(session);
    if (!reservation || reservation.status !== "reserved") return;
    const wallet = await ensureWallet(String(reservation.userId), session);
    wallet.reservedCredits -= reservation.credits;
    wallet.spentCredits += reservation.credits;
    reservation.status = "settled";
    reservation.providerCostUsd = providerCostUsd;
    await Promise.all([wallet.save({ session }), reservation.save({ session })]);
    await LedgerEntry.create([{ userId: reservation.userId, walletId: wallet._id, type: "settlement", amountCredits: -reservation.credits, balanceAfter: wallet.availableCredits, idempotencyKey: `settle:${reservation.id}`, metadata: { providerCostUsd } }], { session });
  });
  await session.endSession();
}

export async function releaseReservation(reservationId: string, reason = "released", outerSession?: mongoose.ClientSession) {
  const session = outerSession ?? await mongoose.startSession();
  const release = async () => {
    const reservation = await CreditReservation.findById(reservationId).session(session);
    if (!reservation || !["reserved", "settled"].includes(reservation.status)) return;
    const wallet = await ensureWallet(String(reservation.userId), session);
    wallet.availableCredits += reservation.credits;
    if (reservation.status === "reserved") wallet.reservedCredits -= reservation.credits;
    if (reservation.status === "settled") {
      wallet.spentCredits -= reservation.credits;
      wallet.refundedCredits += reservation.credits;
    }
    reservation.status = reservation.status === "settled" ? "refunded" : "released";
    await Promise.all([wallet.save({ session }), reservation.save({ session })]);
    await LedgerEntry.create([{ userId: reservation.userId, walletId: wallet._id, type: reservation.status === "refunded" ? "refund" : "release", amountCredits: reservation.credits, balanceAfter: wallet.availableCredits, idempotencyKey: `${reservation.status}:${reservation.id}`, metadata: { reason } }], { session });
  };
  try { if (outerSession) await release(); else await session.withTransaction(release); } finally { if (!outerSession) await session.endSession(); }
}
