import { CreativeJob } from "../models/CreativeJob.js";
import { User } from "../models/User.js";
import { Wallet } from "../models/Wallet.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { Payment } from "../models/Payment.js";
import { CreditReservation } from "../models/CreditReservation.js";
import { AIUsage } from "../models/AIUsage.js";
import { ImageGenerationJob } from "../models/ImageGenerationJob.js";
import { VideoGenerationJob } from "../models/VideoGenerationJob.js";
import { AudioGenerationJob } from "../models/AudioGenerationJob.js";
import { StudioProduction } from "../models/StudioProduction.js";
import { VideoExport } from "../models/VideoEdit.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { SupportAttachment } from "../models/SupportAttachment.js";
import { GatewayUsage } from "./openrouter.js";
import { getPricingPolicy } from "./creditPricingEngine.js";
export const jobModels: Record<string, any> = { image: ImageGenerationJob, video: VideoGenerationJob, voice: AudioGenerationJob, studio: StudioProduction, rendering: VideoExport, creative: CreativeJob };
const sum = (rows: any[], field: string) => rows.reduce((n, r) => n + Number(r[field] || 0), 0);
export async function overview(start: Date, end: Date) {
  const range = { $gte: start, $lte: end };
  const [totalUsers, newUsers, activeUsers, suspendedUsers, payments, ledger, wallets, reservations, aiUsage, assets, exports, attachments, jobs] = await Promise.all([
    User.countDocuments(), User.countDocuments({ createdAt: range }), User.countDocuments({ lastLoginAt: range }), User.countDocuments({ status: "suspended" }),
    Payment.find({ status: "successful", createdAt: range }).select("amount currency credits createdAt userId txRef").lean(), LedgerEntry.find({ createdAt: range }).select("type amountCredits metadata createdAt userId").lean(), Wallet.find().select("availableCredits reservedCredits").lean(),
    CreditReservation.find({ createdAt: range }).select("quote credits status providerCostUsd userId createdAt").lean(), AIUsage.find({ createdAt: range }).select("feature model creditsCharged userId createdAt").lean(),
    MediaAsset.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, bytes: { $sum: "$sizeBytes" } } }]), VideoExport.aggregate([{ $match: { status: "completed" } }, { $group: { _id: null, bytes: { $sum: "$sizeBytes" } } }]), SupportAttachment.aggregate([{ $group: { _id: null, bytes: { $sum: "$size" } } }]),
    Promise.all(Object.entries(jobModels).map(async ([kind, m]) => ({ kind, statuses: await m.aggregate([{ $match: { createdAt: range } }, { $group: { _id: "$status", count: { $sum: 1 } } }]) })))
  ]);
  const revenue: Record<string, number> = {}, sold: Record<string, number> = {}; for (const p of payments) { revenue[p.currency] = (revenue[p.currency] || 0) + p.amount; sold[p.currency] = (sold[p.currency] || 0) + p.credits; }
  const daily = new Map<string, any>(); for (let day = new Date(start); day <= end; day = new Date(day.getTime() + 86400000)) daily.set(day.toISOString().slice(0, 10), { day: day.toISOString().slice(0, 10), revenueUsd: 0, revenueNgn: 0, consumed: 0, estimatedCostUsd: 0 });
  for (const p of payments) { const d = daily.get(p.createdAt.toISOString().slice(0, 10)); if (d) d[p.currency === "USD" ? "revenueUsd" : "revenueNgn"] += p.amount; }
  const consumed = -sum(ledger.filter(l => l.type === "settlement"), "amountCredits"), refunded = sum(ledger.filter(l => l.type === "refund"), "amountCredits");
  for (const l of ledger.filter(l => l.type === "settlement")) { const d = daily.get(l.createdAt.toISOString().slice(0, 10)); if (d) d.consumed -= l.amountCredits; }
  // Only explicit snapshot estimates count. Legacy default zero costs are unknown, not verified expenses.
  const estimates = reservations.filter((r: any) => typeof r.quote?.estimatedCostUsd === "number");
  const groups: Record<string, any[]> = { provider: [], model: [], user: [], feature: [] };
  for (const key of Object.keys(groups)) { const map = new Map<string, any>(); for (const r of estimates as any[]) { const label = key === "user" ? String(r.userId) : String(r.quote?.[key] || "unknown"); const row = map.get(label) || { label, estimatedUsd: 0, reservations: 0, failedOrReleasedUsd: 0 }; row.estimatedUsd += r.quote.estimatedCostUsd; row.reservations++; if (["released", "refunded"].includes(r.status)) row.failedOrReleasedUsd += r.quote.estimatedCostUsd; map.set(label, row); } groups[key] = [...map.values()]; }
  const estimatedExpenses = estimates.reduce((n: number, r: any) => n + r.quote.estimatedCostUsd, 0);
  for (const r of estimates as any[]) { const d = daily.get(r.createdAt.toISOString().slice(0, 10)); if (d) d.estimatedCostUsd += r.quote.estimatedCostUsd; }
  const usdRate = sold.USD ? revenue.USD / sold.USD : null;
  const liabilities = sum(wallets, "availableCredits") + sum(wallets, "reservedCredits");
  const reported = await GatewayUsage.find({ createdAt: range }).select("costUsd usage status").lean();
  const knownReported = reported.filter(r => typeof r.costUsd === "number");
  const policy = await getPricingPolicy();
  const reportedExpensesUsd = knownReported.length ? sum(knownReported, "costUsd") : null;
  const verifiedExpenses = knownReported.filter(r => r.usage?.verifiedCost === true);
  const infrastructureBudgetUsd = policy.values.monthlyInfrastructureUsd * (end.getTime() - start.getTime() + 1) / (86400000 * 30.4375);
  const profitReport = { providerReportedExpensesUsd: reportedExpensesUsd, verifiedGenerationExpensesUsd: verifiedExpenses.length ? sum(verifiedExpenses, "costUsd") : null, reportedRecords: knownReported.length, unreportedRecords: reported.length - knownReported.length, infrastructureBudgetUsd, estimatedUsageRevenueUsd: usdRate === null ? null : (consumed - refunded) * usdRate, note: "Provider response costs are reported usage, not a settled invoice. Account activity is kept separate to avoid double counting. Infrastructure is a configured budget prorated by days. Credit usage revenue is an estimate from the selected USD sales mix; grants, prior-period purchases and non-USD credits are not attributable. Unknown costs prevent a verified net profit." };
  const latestPayments=[...payments].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()).slice(0,8);
  const buyers=await User.find({_id:{$in:latestPayments.map(p=>p.userId)}}).select('displayName email').lean();
  const recentSales=latestPayments.map(p=>({...p,customer:buyers.find(u=>String(u._id)===String(p.userId))?.displayName||'Account unavailable',email:buyers.find(u=>String(u._id)===String(p.userId))?.email}));
  return { recentSales, profitReport, totalUsers, newUsers, activeUsers, suspendedUsers, revenue, creditsSold: sum(payments, "credits"), consumed, refunded, liabilities, liabilityEstimatedUsd: usdRate === null ? null : liabilities * usdRate, estimatedExpenses: estimates.length ? estimatedExpenses : null, verifiedExpenses: null, estimatedCreditUsageRevenueUsd: usdRate === null ? null : (consumed - refunded) * usdRate, estimatedMarginPct: revenue.USD > 0 && estimates.length ? (revenue.USD - estimatedExpenses) / revenue.USD * 100 : null, costCoverage: { estimatedReservations: estimates.length, totalReservations: reservations.length, unknownReservations: reservations.length - estimates.length }, storageBytes: Number(assets[0]?.bytes || 0) + Number(exports[0]?.bytes || 0) + Number(attachments[0]?.bytes || 0), jobs, aiRequests: aiUsage.length, daily: [...daily.values()], costGroups: groups, limitations: ["Revenue is successful recorded payment amounts, grouped by currency; currencies are never added together. Payment processor fees and cash refunds are not inferred.", "Active users means a recorded login within the selected dates. Liabilities are outstanding available plus reserved credits, not a formal accounting valuation.", "AI costs use stored quote estimates only. Legacy zero provider costs are unknown. No verified provider billing records are integrated; actual expenses are unavailable.", "Estimated margin excludes taxes, payment fees, storage, staff costs and unknown AI costs. Credit-value estimates use the selected period's USD sales mix and do not convert NGN.", "AI estimate totals reflect reservation quote budgets, including reserved and released work; they are not a claim that a provider incurred those charges.", "Storage is database-recorded media/export/attachment bytes, not a live R2 billing or physical usage measurement."] };
}
export function csv(rows: Record<string, any>[], columns: string[]) { const cell = (v: any) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; return [columns.map(cell).join(","), ...rows.map(r => columns.map(c => cell(r[c])).join(","))].join("\r\n"); }
