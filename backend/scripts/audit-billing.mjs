// Read-only audit. No wallet/provider mutations or billable API calls.
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config({ path: "../.env.render.private", quiet: true });
dotenv.config({ path: "../.env", quiet: true });
try {
 if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
 await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
 const db = mongoose.connection.db;
 const by = (collection, field, sum) => db.collection(collection).aggregate([{ $group: { _id: field, count: { $sum: 1 }, total: { $sum: sum } } }]).toArray();
 const report = {
  asOf: new Date().toISOString(), database: db.databaseName,
  ledger: await by("ledgerentries", "$type", "$amountCredits"),
  reservations: await by("creditreservations", "$status", "$credits"),
  settledByModel: await db.collection("creditreservations").aggregate([{ $match: { status: "settled" } }, { $group: { _id: "$quote.model", count: { $sum: 1 }, credits: { $sum: "$credits" }, quotedProviderUsd: { $sum: "$quote.estimatedCostUsd" } } }]).toArray(),
  gatewayUsage: await db.collection("gatewayusages").aggregate([{ $group: { _id: { kind: "$kind", model: "$model", status: "$status" }, count: { $sum: 1 }, reportedCostUsd: { $sum: "$costUsd" }, missingCost: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$costUsd", null] }, null] }, 1, 0] } } } }]).toArray(),
  policy: await db.collection("pricingpolicies").findOne({ _id: "global" }, { projection: { values: 1, revision: 1 } }),
  duplicateLedgerKeys: await db.collection("ledgerentries").aggregate([{ $group: { _id: "$idempotencyKey", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "groups" }]).toArray(),
  limits: ["Wallet settlement records are accounting events, not an additional deduction after reservation.", "Missing provider cost is unknown, not zero.", "Provider balance differences alone cannot identify refund amounts.", "No historical credits were modified."]
 };
 console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error("Read-only billing audit unavailable:", error.code || error.name); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
