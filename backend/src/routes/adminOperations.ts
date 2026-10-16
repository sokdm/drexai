import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { getPricingPolicy, pricingPolicySchema, quoteAutomaticCredits } from "../services/creditPricingEngine.js";
import { providerAccountStatus, verifyGenerationCost } from "../services/openrouterManagement.js";
import { WebsiteSettings, EmailTemplate, EmailDelivery, OperationalAlert, PricingPolicy, PricingOverride, ModelPresentation, ProviderActivity } from "../models/Finance.js";
import { GatewayUsage } from "../services/openrouter.js";
import { AdminAudit, PlatformControl } from "../models/Admin.js";
import { Wallet } from "../models/Wallet.js";
import { User } from "../models/User.js";
import { AIProject } from "../models/AIProject.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { Notification } from "../models/Notification.js";
import { SupportEmail } from "../models/SupportEmail.js";
import { RenderWorker } from "../models/VideoEdit.js";
import { env } from "../config/env.js";
import { persistentStorageConfigured } from "../services/mediaStorage.js";
import { studioWorkerOnline } from "../services/studioQueue.js";
import { getImageQueue } from "../services/imageQueue.js";
import { getVideoQueue } from "../services/videoQueue.js";

export const adminOperationsRouter = Router();
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
const reason = z.string().trim().min(10).max(1000), id = z.string().regex(/^[a-f\d]{24}$/i);
async function saveAudited(req: any, action: string, target: string, why: string, execute: (session: any) => Promise<any>) {
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => { const data = await execute(session); await AdminAudit.create([{ actorId: req.adminUser._id, action, target, reason: why, ...data }], { session }); }); } finally { await session.endSession(); }
}
adminOperationsRouter.get("/website-settings", wrap(async (_req: any, res: any) => res.json({ settings: await WebsiteSettings.findById("public").lean() || { siteName: "Drex", description: "Your AI creation workspace", supportEmail: "" } })));
adminOperationsRouter.put("/website-settings", wrap(async (req: any, res: any) => {
 const input = z.object({ siteName: z.string().trim().min(2).max(60), description: z.string().trim().min(3).max(160), supportEmail: z.string().email().or(z.literal("")), reason }).parse(req.body);
 await saveAudited(req, "website-settings", "public", input.reason, async session => { const old = await WebsiteSettings.findById("public").session(session); const { reason: why, ...data } = input; await WebsiteSettings.updateOne({ _id: "public" }, { $set: data }, { upsert: true, session }); return { before: old?.toObject(), after: data }; }); res.json({ ok: true });
}));
adminOperationsRouter.get("/pricing-policy", wrap(async (_req: any, res: any) => res.json(await getPricingPolicy())));
adminOperationsRouter.put("/pricing-policy", wrap(async (req: any, res: any) => {
  const input = z.object({ values: pricingPolicySchema, reason, revision: z.number().int().positive() }).parse(req.body);
  await saveAudited(req, "pricing-policy", "global", input.reason, async session => {
    const old = await PricingPolicy.findById("global").session(session);
    if ((old?.revision || 1) !== input.revision) throw Object.assign(new Error("Pricing changed in another session. Refresh before saving."), { statusCode: 409 });
    await PricingPolicy.updateOne({ _id: "global" }, { $set: { values: input.values, updatedBy: req.adminUser._id, revision: input.revision + 1 } }, { upsert: true, session });
    return { before: old?.toObject(), after: input.values };
  }); res.json({ ok: true, ...await getPricingPolicy() });
}));
adminOperationsRouter.post("/pricing-preview", wrap(async (req: any, res: any) => {
 const input = z.object({ feature: z.string().max(80), model: z.string().max(100), quantity: z.number().positive().max(100000), unit: z.string().max(50), settings: z.record(z.unknown()).default({}) }).parse(req.body);
 res.json({ quote: await quoteAutomaticCredits(input), note: "Estimate only. This does not reserve credits or make an AI generation request." });
}));
adminOperationsRouter.post("/pricing-overrides", wrap(async (req: any, res: any) => {
 const input = z.object({ feature: z.string().min(2).max(80), model: z.string().min(2).max(100), unit: z.string().min(1).max(50), costUsd: z.string().regex(/^\d+(\.\d{1,12})?$/).refine(v => Number(v) > 0 && Number(v) <= 10000), verificationUrl: z.string().url().refine(v => v.startsWith("https://")), expiresAt: z.string().datetime().refine(v => new Date(v).getTime() > Date.now() && new Date(v).getTime() < Date.now() + 31 * 86400000), settings: z.record(z.unknown()).default({}), reason }).parse(req.body);
 let saved: any; await saveAudited(req, "pricing-cost-verification", input.model, input.reason, async session => { const { reason: why, ...values } = input; [saved] = await PricingOverride.create([{ ...values, verifiedAt: new Date(), actorId: req.adminUser._id }], { session }); return { after: values }; });
 res.status(201).json({ override: saved });
}));
adminOperationsRouter.get("/pricing-overrides", wrap(async (_req: any, res: any) => res.json({ rows: await PricingOverride.find().sort({ createdAt: -1 }).limit(100) })));
adminOperationsRouter.get("/provider-account", wrap(async (_req: any, res: any) => res.json(await providerAccountStatus())));
adminOperationsRouter.post("/provider-account/refresh", wrap(async (req: any, res: any) => { const data = await providerAccountStatus(true); await AdminAudit.create({ actorId: req.adminUser._id, action: "provider-sync", target: "openrouter", reason: "Manual non-billable provider account synchronization" }); res.json(data); }));
adminOperationsRouter.get("/provider-usage", wrap(async (req: any, res: any) => {
 const input = z.object({ start: z.string().date(), end: z.string().date() }).parse(req.query);
 const range = { $gte: new Date(input.start), $lte: new Date(input.end + "T23:59:59.999Z") };
 if (range.$lte < range.$gte || range.$lte.getTime() - range.$gte.getTime() > 366 * 86400000) throw new Error("Select a period of at most one year");
 const local = await GatewayUsage.find({ createdAt: range }).select("model kind costUsd usage status createdAt userId").sort({ createdAt: -1 }).limit(10000).lean();
 const aggregate = (key: (r: any) => string) => { const map = new Map(); for (const r of local) { const label = key(r), row = map.get(label) || { label, costUsd: 0, requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, unknownCosts: 0 }; row.requests++; if (r.status === "failed") row.failed++; if (typeof r.costUsd === "number") row.costUsd += r.costUsd; else row.unknownCosts++; row.inputTokens += Number(r.usage?.prompt_tokens || 0); row.outputTokens += Number(r.usage?.completion_tokens || 0); map.set(label, row); } return [...map.values()]; };
 res.json({ daily: aggregate(r => r.createdAt.toISOString().slice(0, 10)), models: aggregate(r => r.model || "unknown"), features: aggregate(r => r.kind || "unknown"), total: aggregate(() => "Selected period")[0] || null, providerActivity: await ProviderActivity.find({ date: { $gte: input.start, $lte: input.end } }).sort({ date: -1 }).limit(1000), truncated: local.length === 10000, note: "Local reported usage is separate from account activity and is not added to it. Binary speech responses may have no reported cost. Activity covers the provider's completed UTC days; local logs preserve longer history." });
}));
adminOperationsRouter.post("/provider-generation/:id/verify", wrap(async (req: any, res: any) => res.json(await verifyGenerationCost(String(req.params.id)))));
adminOperationsRouter.get("/operations/:kind", wrap(async (req: any, res: any) => {
 const kind = z.enum(["wallets", "projects", "notifications", "email", "alerts", "deliveries"]).parse(req.params.kind), input = z.object({ before: id.optional(), search: z.string().max(100).default(""), status: z.string().max(50).optional() }).parse(req.query);
 const models: Record<string, any> = { wallets: Wallet, projects: AIProject, notifications: Notification, email: SupportEmail, alerts: OperationalAlert, deliveries: EmailDelivery };
 const fields: Record<string, string> = { deliveries: "recipient subject status provider error createdAt", wallets: "userId availableCredits reservedCredits purchasedCredits spentCredits refundedCredits updatedAt", projects: "userId title type language approvedAt latestProductionId finalExportId createdAt", notifications: "userId title type readAt createdAt", email: "userId ticketId subject status attempts sentAt error createdAt", alerts: "key title content severity readAt lastOccurredAt count createdAt" };
 const query: any = input.before ? { _id: { $lt: input.before } } : {};
 if (input.status && ["email", "deliveries"].includes(kind)) query.status = input.status;
 if (input.search) { const escaped = input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); if (kind === "wallets") { const people = await User.find({ email: { $regex: escaped, $options: "i" } }).select("_id").limit(100); query.userId = { $in: people.map(p => p._id) }; } else query[["email", "deliveries"].includes(kind) ? "subject" : "title"] = { $regex: escaped, $options: "i" }; }
 const rows = await models[kind].find(query).select(fields[kind]).sort({ _id: -1 }).limit(51).lean();
 const users = await User.find({ _id: { $in: rows.map((r: any) => r.userId).filter(Boolean) } }).select("email displayName").lean();
 res.json({ rows: rows.slice(0, 50).map((r: any) => ({ ...r, customer: users.find(u => String(u._id) === String(r.userId))?.email || "" })), next: rows.length > 50 ? String(rows[49]._id) : null });
}));
adminOperationsRouter.post("/alerts/:id/read", wrap(async (req: any, res: any) => { await OperationalAlert.updateOne({ _id: id.parse(req.params.id) }, { $set: { readAt: new Date() } }); res.json({ ok: true }); }));
adminOperationsRouter.get("/model-presentation", wrap(async (_req: any, res: any) => res.json({ rows: await ModelPresentation.find().lean() })));
adminOperationsRouter.put("/model-presentation", wrap(async (req: any, res: any) => {
 const input = z.object({ model: z.string().min(2).max(100), displayName: z.string().min(2).max(100), tier: z.enum(["standard", "enhanced", "premium", "ultra"]), verificationUrl: z.string().url().refine(v => v.startsWith("https://")), reason }).parse(req.body);
 await saveAudited(req, "model-presentation", input.model, input.reason, async session => { const old = await ModelPresentation.findOne({ model: input.model }).session(session); const { reason: why, ...data } = input; await ModelPresentation.updateOne({ model: data.model }, { $set: data }, { upsert: true, session }); return { before: old?.toObject(), after: data }; }); res.json({ ok: true });
}));
adminOperationsRouter.get("/system-health", wrap(async (_req: any, res: any) => {
 const queue = async (get: () => any) => { let timer: any; try { return await Promise.race([get().getWorkers().then((rows: any[]) => ({ connected: true, workers: rows.length })), new Promise(resolve => { timer = setTimeout(() => resolve({ connected: false, workers: null }), 2500); })]); } catch { return { connected: false, workers: null }; } finally { clearTimeout(timer); } };
 const [image, video, studio, render] = await Promise.all([queue(getImageQueue), queue(getVideoQueue), studioWorkerOnline(), RenderWorker.find({ expiresAt: { $gt: new Date() } }).select("_id expiresAt").lean()]);
 res.json({ checkedAt: new Date(), databaseConnected: mongoose.connection.readyState === 1, image, video, studioWorkerOnline: studio, renderWorkers: render, storageConfigured: persistentStorageConfigured(), note: "Queue status and worker heartbeats are live checks. Storage configured does not claim bucket accessibility or billing verification." });
}));

adminOperationsRouter.get("/email-template", wrap(async (_req: any, res: any) => { const template = await EmailTemplate.findById("welcome").lean(); res.json({ template: template || { _id: "welcome", subject: "Welcome to Drex", body: "Welcome {{name}}. Your Drex workspace is ready. Sign in to get started." }, note: "Editable welcome email only. Security/OTP templates are not editable here. Existing SMTP acceptance is not proof of final inbox delivery." }); }));
adminOperationsRouter.put("/email-template", wrap(async (req: any, res: any) => { const input = z.object({ subject: z.string().min(3).max(150).refine(v => !/[\r\n]/.test(v)), body: z.string().min(10).max(5000), reason }).parse(req.body); await saveAudited(req, "email-template", "welcome", input.reason, async session => { const before = await EmailTemplate.findById("welcome").session(session); await EmailTemplate.updateOne({ _id: "welcome" }, { $set: { subject: input.subject, body: input.body } }, { upsert: true, session }); return { before: before?.toObject(), after: { subject: input.subject, body: input.body } }; }); res.json({ ok: true }); }));
