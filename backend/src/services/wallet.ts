import {blockedModel,assertAllowedModel} from "./modelPolicy.js";
import { AppMigration, DailySpendBudget } from "../models/Finance.js";
import { AdminAudit } from "../models/Admin.js";
import { isOpenRouter, GatewayUsage } from "./openrouter.js";
import { checkGenerationUser, assertProviderBudget } from "./platformControl.js";
import { ProviderControl } from "../models/Admin.js";
import mongoose from "mongoose";
import { CreditPackage } from "../models/CreditPackage.js";
import { CreditReservation } from "../models/CreditReservation.js";
import { GenerationPriceRule } from "../models/GenerationPriceRule.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { Wallet } from "../models/Wallet.js";

export async function seedCreditConfig() {
  const referencePackages=[{key:'mini',name:'Mini',credits:500,amount:12,sortOrder:0,promotion:'Occasional use'},{key:'starter',name:'Starter',credits:2000,amount:42,sortOrder:1,promotion:'Growing creators'},{key:'plus',name:'Plus',credits:5000,amount:90,sortOrder:2,promotion:'Regular production'},{key:'creator',name:'Creator',credits:12000,amount:192,sortOrder:3,promotion:'Best credit value'}];
  for(const pkg of referencePackages)await CreditPackage.updateOne({key:pkg.key},{$setOnInsert:{...pkg,currency:'USD',active:true}},{upsert:true});
  const migrationSession = await mongoose.startSession();
  try { await migrationSession.withTransaction(async () => {
    if (await AppMigration.findById("credit-packages-20261016").session(migrationSession)) return;
    for (const [key, credits, before, amount] of [["starter", 1000, 15, 20], ["creator", 5000, 50, 90]] as const) {
      const changed = await CreditPackage.findOneAndUpdate({ key, credits, amount: before, currency: "USD", promotion: { $in: ["", null] } }, { $set: { amount } }, { session: migrationSession });
      if (changed) await AdminAudit.create([{ action: "default-package-upgrade", target: key, reason: "Owner requested updated credit package prices", before: { amount: before, credits }, after: { amount, credits } }], { session: migrationSession });
    }
    await AppMigration.create([{ _id: "credit-packages-20261016", appliedAt: new Date() }], { session: migrationSession });
  }); } finally { await migrationSession.endSession(); }
  const creatorSession=await mongoose.startSession();try{await creatorSession.withTransaction(async()=>{if(await AppMigration.findById('creator-value-20261020').session(creatorSession))return;const old=await CreditPackage.findOneAndUpdate({key:'creator',credits:5000,amount:90,currency:'USD',promotion:{$in:['',null]}},{$set:{amount:80}},{session:creatorSession});if(old)await AdminAudit.create([{action:'creator-package-value-update',target:'creator',reason:'Owner requested Creator credits valued at 0.016 USD each',before:{amount:90,credits:5000},after:{amount:80,credits:5000}}],{session:creatorSession});await AppMigration.create([{_id:'creator-value-20261020',appliedAt:new Date()}],{session:creatorSession});});}finally{await creatorSession.endSession();}
  const referenceSession=await mongoose.startSession();try{await referenceSession.withTransaction(async()=>{if(await AppMigration.findById('reference-packages-20261020').session(referenceSession))return;for(const pkg of referencePackages){const before=await CreditPackage.findOne({key:pkg.key}).session(referenceSession);await CreditPackage.updateOne({key:pkg.key},{$set:{...pkg,currency:'USD',active:true}},{session:referenceSession});await AdminAudit.create([{action:'reference-package-update',target:pkg.key,reason:'Owner approved the exact four-tier package reference',before:before?.toObject(),after:{...pkg,currency:'USD',active:true}}],{session:referenceSession});}await AppMigration.create([{_id:'reference-packages-20261020',appliedAt:new Date()}],{session:referenceSession});});}finally{await referenceSession.endSession();}
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
  if(!Number.isSafeInteger(credits)||credits<=0)throw new Error("Purchase credits must be a positive safe integer");
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
  if(blockedModel(input.model))return {allowed:false,credits:0,feature:input.feature,model:input.model,reason:"This retired route is disabled. Prepare operation approvals to choose an available model."};
  if (isOpenRouter(input.model)) { try { return await (await import("./creditPricingEngine.js")).quoteAutomaticCredits(input); } catch (error: any) { return { allowed: false, credits: 0, reason: error.message, feature: input.feature, provider: input.provider, model: input.model }; } }
  const rule = await GenerationPriceRule.findOne({ feature: input.feature, provider: input.provider, model: input.model, active: true, ...(input.unit ? { unit: input.unit } : {}), ...(input.ruleId ? { _id: input.ruleId } : {}) });
  if (isOpenRouter(input.model) && (!rule || !(rule.providerCostUsd > 0))) return { allowed: false, credits: 0, reason: "Configure verified OpenRouter provider pricing before generating." };
  if (!rule) return { allowed: false, credits: 0, reason: "Pricing is not active until provider costs are verified." };
  const quantity = Math.max(1, Number(input.quantity ?? 1));
  if(!(rule.providerCostUsd>0))return {allowed:false,credits:0,reason:"A verified positive provider cost is required for paid operations."};
  const {calculateCreditPrice,getPricingPolicy}=await import("./creditPricingEngine.js");
  const policy=await getPricingPolicy();const packages=await CreditPackage.find({active:true,currency:"USD"}).lean();
  const floor=calculateCreditPrice(rule.providerCostUsd*quantity,packages,{...policy.values,marginPct:Math.max(50,policy.values.marginPct,Number(rule.desiredMarginPct||0))},quantity,input.feature==="text_to_image");
  const credits = Math.max(Math.ceil(rule.creditsPerUnit * quantity),floor.credits);
  return { allowed: true, credits, feature: input.feature, provider: input.provider, model: input.model, estimatedCostUsd: rule.providerCostUsd > 0 ? rule.providerCostUsd * quantity : null, ruleId: rule._id, quantity, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
}

export async function reserveCredits(userId: string, quote: any, idempotencyKey: string, outerSession?: mongoose.ClientSession): Promise<any> {
  if(quote.model)assertAllowedModel(quote.model);
  const prior = await CreditReservation.findOne({ idempotencyKey }).session(outerSession ?? null);
  if (prior) { if (String(prior.userId) !== userId) throw new Error("Reservation ownership mismatch"); return prior; }
  await checkGenerationUser(userId);
  if (quote.provider === "openrouter" && quote.estimatedCostUsd !== undefined && Number(quote.estimatedCostUsd)>0) await (await import("./openrouterManagement.js")).checkProviderAffordability(quote.estimatedCostUsd);
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
    if (quote.provider === "openrouter" && quote.estimatedCostUsd > 0) {
      const { values } = await (await import("./creditPricingEngine.js")).getPricingPolicy();
      const day = new Date().toISOString().slice(0, 10);
      for (const [key, limit] of [["global:" + day, values.globalDailyUsd], ["user:" + userId + ":" + day, values.userDailyUsd]] as const) {
        await DailySpendBudget.updateOne({ _id: key }, { $setOnInsert: { admittedUsd: 0 } }, { upsert: true, session });
        const admitted = await DailySpendBudget.updateOne({ _id: key, admittedUsd: { $lte: limit - quote.estimatedCostUsd } }, { $inc: { admittedUsd: quote.estimatedCostUsd } }, { session });
        if (!admitted.modifiedCount) throw Object.assign(new Error("The daily generation allowance has been reached. Try again after the next UTC day or contact support. No new credits were reserved."),{code:"APPROVAL_STATE",statusCode:429});
      }
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

export async function settleReservation(reservationId: string, providerCostUsd?: number) {
  const prior = await CreditReservation.findById(reservationId);
  if (!prior || prior.status !== "reserved") return prior;
  if (providerCostUsd === undefined && prior.quote?.provider === "openrouter") {
    const rows = await GatewayUsage.find({ reservationId, status: "completed" }).lean();
    if (rows.length && rows.every(r => typeof r.costUsd === "number" && r.costUsd >= 0)) providerCostUsd = rows.reduce((n, r) => n + r.costUsd!, 0);
  }
  let credits = prior.credits;
  // Reconcile only new, frozen automatic quotes with positively identified usage.
  // Historical records and unknown costs retain their approved terms.
  if (typeof providerCostUsd === "number" && Number.isFinite(providerCostUsd) && providerCostUsd >= 0 && prior.quote?.assumptions && prior.quote?.creditUsd) {
    const { calculateCreditPrice } = await import("./creditPricingEngine.js");
    credits = providerCostUsd === 0 ? 0 : Math.min(credits, calculateCreditPrice(providerCostUsd, [{ amount: Number(prior.quote.creditUsd), credits: 1 }], prior.quote.assumptions, prior.quote.quantity || 1, prior.quote.feature === "text_to_image").credits);
  }
  credits = Math.min(prior.credits, Math.max(credits, Number(prior.quote?.serviceMinimumCredits || 0)));
  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    const reservation = await CreditReservation.findById(reservationId).session(session);
    if (!reservation || reservation.status !== "reserved") return;
    const wallet = await ensureWallet(String(reservation.userId), session);
    const released = reservation.credits - credits;
    wallet.reservedCredits -= reservation.credits;
    wallet.spentCredits += credits;
    wallet.availableCredits += released;
    reservation.credits = credits;
    reservation.status = "settled";
    reservation.providerCostUsd = providerCostUsd;
    await Promise.all([wallet.save({ session }), reservation.save({ session })]);
    await LedgerEntry.create([{ userId: reservation.userId, walletId: wallet._id, type: "settlement", amountCredits: -reservation.credits, balanceAfter: wallet.availableCredits, idempotencyKey: `settle:${reservation.id}`, metadata: { providerCostUsd } }], { session });
    if (released > 0) await LedgerEntry.create([{ userId: reservation.userId, walletId: wallet._id, type: "release", amountCredits: released, balanceAfter: wallet.availableCredits, idempotencyKey: `actual-cost-release:${reservation.id}`, metadata: { reason: "Verified actual provider cost below approved ceiling", providerCostUsd } }], { session });
  });
  await session.endSession();
  return CreditReservation.findById(reservationId);
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
