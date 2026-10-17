import mongoose, { Schema, model } from "mongoose";
import { createHash } from "node:crypto";
import { env } from "../config/env.js";

const schema = new Schema({ _id: String, count: { type: Number, default: 0 }, expiresAt: Date });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const FreeAiUsage = model("FreeAiUsage", schema);
export function verifiedFreeText(record: any) {
 const prices = Object.values(record.pricing || {});
 return record.id?.endsWith(":free") && prices.length > 0 && record.pricing.prompt !== undefined && record.pricing.completion !== undefined && prices.every(v => v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) === 0);
}
export async function freeAiStatus(now = new Date()) {
 const { values } = await (await import("./creditPricingEngine.js")).getPricingPolicy();
 const scope = createHash("sha256").update(env.OPENROUTER_API_KEY || "unconfigured").digest("hex").slice(0, 24);
 const rows = await FreeAiUsage.find({ _id: { $in: [`${scope}:day:${now.toISOString().slice(0, 10)}`, `${scope}:minute:${now.toISOString().slice(0, 16)}`] } }).lean();
 return { dayRequests: rows.find(r => r._id?.includes(":day:"))?.count || 0, minuteRequests: rows.find(r => r._id?.includes(":minute:"))?.count || 0, dayLimit: values.freeSharedDailyRequests, minuteLimit: values.freeSharedMinuteRequests, userDayLimit: values.freeUserDailyRequests, note: "Application-counted attempts across this API key and MongoDB deployment. Provider usage outside Drex is not included; OpenRouter can impose additional restrictions." };
}
export async function admitFreeAi(userId?: string, now = new Date()) {
 if (!userId || !mongoose.isValidObjectId(userId)) throw new Error("Free AI requires a signed-in user.");
 const { values } = await (await import("./creditPricingEngine.js")).getPricingPolicy();
 const scope = createHash("sha256").update(env.OPENROUTER_API_KEY || "unconfigured").digest("hex").slice(0, 24);
 const day = now.toISOString().slice(0, 10), minute = now.toISOString().slice(0, 16);
 const buckets = [
  { id: `${scope}:user:${userId}:${day}`, limit: values.freeUserDailyRequests },
  { id: `${scope}:day:${day}`, limit: values.freeSharedDailyRequests },
  { id: `${scope}:minute:${minute}`, limit: values.freeSharedMinuteRequests }
 ];
 for (const b of buckets) {
  try { await FreeAiUsage.updateOne({ _id: b.id }, { $setOnInsert: { count: 0, expiresAt: new Date(now.getTime() + 172800000) } }, { upsert: true }); }
  catch (e: any) { if (e.code !== 11000) throw e; }
 }
 const session = await mongoose.startSession();
 try {
  await session.withTransaction(async () => {
   for (const b of buckets) {
    const result = await FreeAiUsage.updateOne({ _id: b.id, count: { $lt: b.limit } }, { $inc: { count: 1 } }, { session });
    if (result.modifiedCount !== 1) throw Object.assign(new Error("Free AI request limit reached. Wait for the limit to reset, or select a paid model and approve its credit quote. No paid request was submitted."), { code: "FREE_AI_LIMIT", status: 429 });
   }
  });
 } finally { await session.endSession(); }
}
