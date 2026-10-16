import express, { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import sharp from "sharp";
import rateLimit from "express-rate-limit";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { SupportTicket, supportCategories } from "../models/SupportTicket.js";
import { SupportMessage } from "../models/SupportMessage.js";
import { SupportAttachment } from "../models/SupportAttachment.js";
import { User } from "../models/User.js";
import { notify } from "../services/notifications.js";
import { queueSupportEmail } from "../services/supportEmail.js";
import { emitSupportEvent, emitUserEvent } from "../realtime.js";

export const supportRouter = Router();
supportRouter.use(requireAuth, requireCsrf);
export const isSupport = (user: any) => ["admin", "support"].includes(user?.role);
export const requireSupport = (req: any, res: any, next: any) => isSupport(req.user) ? next() : res.status(403).json({ error: "Support administrator access required" });
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
const id = z.string().regex(/^[a-f\d]{24}$/i), requestId = z.string().uuid();
const fail = (message: string, statusCode = 400): never => { throw Object.assign(new Error(message), { statusCode }); };
const messageInput = z.object({ content: z.string().trim().min(1).max(10000), attachments: z.array(id).max(3).default([]).refine(v => new Set(v).size === v.length), requestId });
async function ownTicket(req: any, session?: any) { const t = await SupportTicket.findOne({ _id: id.parse(req.params.id), ...(!isSupport(req.user) ? { userId: req.user._id } : {}) }).session(session || null); if (!t) fail("Ticket not found", 404); return t!; }
async function addMessage(req: any, ticket: any, input: z.infer<typeof messageInput>, session: any) {
  const existing = await SupportMessage.findOne({ ticketId: ticket._id, senderId: req.user._id, requestId: input.requestId }).session(session); if (existing) return existing;
  const [message] = await SupportMessage.create([{ ticketId: ticket._id, senderId: req.user._id, senderName: req.user.displayName, senderRole: req.user.role, ...input, ...(isSupport(req.user) ? { readBySupportAt: new Date() } : { readByUserAt: new Date() }) }], { session });
  for (const attachmentId of input.attachments) { const attachment = await SupportAttachment.findOneAndUpdate({ _id: attachmentId, userId: req.user._id, messageId: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { ticketId: ticket._id, messageId: message._id }, $unset: { expiresAt: 1 } }, { new: true, session }); if (!attachment) fail("An attachment is unavailable. Upload it again."); }
  ticket.lastMessageAt = new Date(); ticket.status = isSupport(req.user) ? "waiting" : "open"; ticket.revision++; await ticket.save({ session });
  if (isSupport(req.user) && String(ticket.userId) !== String(req.user._id)) {
    await notify({ userId: ticket.userId, eventKey: `support-reply:${message._id}`, type: "support", title: "Support replied", content: ticket.subject, href: `/dashboard/support?ticket=${ticket._id}` }, session);
    await queueSupportEmail(ticket.userId, ticket._id, `reply:${message._id}`, "Drex support replied to your ticket", `Support has replied to: ${ticket.subject}. Sign in to read your private conversation.`, session);
  }
  return message;
}
supportRouter.get("/config", wrap(async (req: any, res: any) => { res.json({ categories: supportCategories, staff: isSupport(req.user), attachmentTypes: ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"], maxAttachmentBytes: 5 * 1024 * 1024, maxAttachments: 3 }); }));
supportRouter.get("/agents", requireSupport, wrap(async (_req: any, res: any) => { res.json({ agents: await User.find({ role: { $in: ["admin", "support"] }, status: "active" }).select("displayName role") }); }));
supportRouter.get("/tickets", wrap(async (req: any, res: any) => {
  const input = z.object({ admin: z.enum(["true", "false"]).optional(), search: z.string().max(100).optional(), status: z.enum(["open", "waiting", "resolved", "closed"]).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), category: z.enum(supportCategories).optional(), assignedTo: id.optional(), before: id.optional() }).parse(req.query);
  if (input.admin === "true" && !isSupport(req.user)) return res.status(403).json({ error: "Support administrator access required" });
  const { admin, search, before, ...filters } = input;
  const query = { ...(admin === "true" ? {} : { userId: req.user._id }), ...filters, ...(search ? { subject: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {}), ...(before ? { _id: { $lt: before } } : {}) };
  const tickets = await SupportTicket.find(query).sort({ _id: -1 }).limit(31).populate("assignedTo", "displayName"); res.json({ tickets: tickets.slice(0, 30), next: tickets.length > 30 ? String(tickets[29]._id) : null });
}));
supportRouter.post("/tickets", rateLimit({ windowMs: 3600000, limit: 15 }), wrap(async (req: any, res: any) => {
  const input = messageInput.extend({ subject: z.string().trim().min(3).max(150), category: z.enum(supportCategories) }).parse(req.body);
  let ticket: any; const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    ticket = await SupportTicket.findOne({ userId: req.user._id, requestId: input.requestId }).session(session); if (ticket) return;
    [ticket] = await SupportTicket.create([{ userId: req.user._id, requestId: input.requestId, subject: input.subject, category: input.category, history: [{ actorId: req.user._id, action: "Ticket opened" }] }], { session });
    await addMessage(req, ticket, input, session); await queueSupportEmail(req.user._id, ticket._id, `ticket:${ticket._id}`, "Your Drex support ticket is open", `We received your support request: ${ticket.subject}.`, session);
  }); } finally { await session.endSession(); }
  emitSupportEvent(String(ticket.userId), String(ticket._id)); res.status(201).json({ ticket });
}));
supportRouter.get("/tickets/:id", wrap(async (req: any, res: any) => {
  const ticket = await ownTicket(req), before = id.optional().parse(req.query.before);
  const messages = await SupportMessage.find({ ticketId: ticket._id, ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(51).populate("attachments", "name contentType size");
  res.json({ ticket, messages: messages.slice(0, 50).reverse(), next: messages.length > 50 ? String(messages[49]._id) : null, canReopen: ticket.status === "resolved" && !!ticket.resolvedAt && Date.now() - ticket.resolvedAt.getTime() <= 30 * 86400000 });
}));
supportRouter.post("/tickets/:id/messages", rateLimit({ windowMs: 60000, limit: 20 }), wrap(async (req: any, res: any) => {
  const input = messageInput.parse(req.body); let ticket: any, message: any; const session = await mongoose.startSession();
  try { await session.withTransaction(async () => { ticket = await ownTicket(req, session); const existing = await SupportMessage.findOne({ ticketId: ticket._id, senderId: req.user._id, requestId: input.requestId }).session(session); if (existing) { message = existing; return; } if (["resolved", "closed"].includes(ticket.status)) fail("Reopen this ticket before sending another message.", 409); message = await addMessage(req, ticket, input, session); }); } finally { await session.endSession(); }
  emitSupportEvent(String(ticket.userId), String(ticket._id)); emitUserEvent(String(ticket.userId), "notifications:changed", {}); res.status(201).json({ message });
}));
supportRouter.post("/tickets/:id/read", wrap(async (req: any, res: any) => { const ticket = await ownTicket(req), through = id.parse(req.body.through), field = isSupport(req.user) ? "readBySupportAt" : "readByUserAt"; const result = await SupportMessage.updateMany({ ticketId: ticket._id, _id: { $lte: through }, [field]: null }, { $set: { [field]: new Date() } }); if (result.modifiedCount) emitSupportEvent(String(ticket.userId), String(ticket._id)); res.json({ ok: true }); }));
supportRouter.patch("/tickets/:id", requireSupport, wrap(async (req: any, res: any) => {
  const input = z.object({ revision: z.number().int().nonnegative(), status: z.enum(["open", "waiting", "resolved", "closed"]).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), assignedTo: id.nullable().optional() }).parse(req.body);
  if (input.assignedTo && !await User.exists({ _id: input.assignedTo, role: { $in: ["admin", "support"] }, status: "active" })) fail("Choose an active support agent.");
  let ticket: any; const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    ticket = await ownTicket(req, session); if (ticket.revision !== input.revision) fail("Ticket changed. Refresh before updating.", 409);
    const prior = ticket.status, { revision, ...changes } = input; Object.assign(ticket, changes); ticket.revision++; ticket.history.push({ actorId: req.user._id, action: Object.entries(changes).map(([k, v]) => `${k}: ${v ?? "unassigned"}`).join(", ") });
    if (input.status === "resolved" && prior !== "resolved") { ticket.resolvedAt = new Date(); await queueSupportEmail(ticket.userId, ticket._id, `resolved:${ticket._id}:${ticket.revision}`, "Your Drex ticket was resolved", `Your ticket "${ticket.subject}" has been resolved. You can reopen it within 30 days if you still need help.`, session); await notify({ userId: ticket.userId, eventKey: `resolved:${ticket._id}:${ticket.revision}`, type: "support", title: "Support ticket resolved", content: ticket.subject, href: `/dashboard/support?ticket=${ticket._id}` }, session); }
    await ticket.save({ session });
  }); } finally { await session.endSession(); }
  emitSupportEvent(String(ticket.userId), String(ticket._id)); emitUserEvent(String(ticket.userId), "notifications:changed", {}); res.json({ ticket });
}));
supportRouter.post("/tickets/:id/reopen", wrap(async (req: any, res: any) => {
  const ticket = await ownTicket(req); if (!isSupport(req.user) && (ticket.status !== "resolved" || !ticket.resolvedAt || Date.now() - ticket.resolvedAt.getTime() > 30 * 86400000)) fail("This ticket is not eligible to reopen. Open a new request.", 409);
  const result = await SupportTicket.findOneAndUpdate({ _id: ticket._id, revision: ticket.revision }, { $set: { status: "open" }, $inc: { revision: 1 }, $push: { history: { actorId: req.user._id, action: "Ticket reopened", at: new Date() } } }, { new: true }); if (!result) fail("Ticket changed. Refresh and try again.", 409); emitSupportEvent(String(ticket.userId), String(ticket._id)); res.json({ ticket: result });
}));
supportRouter.post("/attachments", rateLimit({ windowMs: 3600000, limit: 30 }), express.raw({ type: ["image/*", "application/pdf", "text/plain"], limit: "5mb" }), wrap(async (req: any, res: any) => {
  let bytes = req.body; if (!Buffer.isBuffer(bytes) || !bytes.length) fail("Choose a supported file under 5 MB.");
  const type = String(req.headers["content-type"]).split(";")[0], name = z.string().min(1).max(150).parse(decodeURIComponent(String(req.headers["x-file-name"] || "attachment"))).replace(/[\r\n"\\/]/g, "_"); let contentType = type;
  if (["image/png", "image/jpeg", "image/webp"].includes(type)) { try { const img = sharp(bytes, { limitInputPixels: 20000000 }); const meta = await img.metadata(); if (!["png", "jpeg", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1) throw new Error(); bytes = await img.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).png().toBuffer(); contentType = "image/png"; } catch { fail("This image could not be read."); } }
  else if (type === "application/pdf") { if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) fail("This file is not a PDF."); }
  else if (type === "text/plain") { try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (bytes.includes(0)) throw new Error(); } catch { fail("Choose a UTF-8 text file."); } }
  else fail("Supported attachments: PNG, JPG, WebP, PDF and text.");
  if (bytes.length > 5 * 1024 * 1024) fail("Processed attachment exceeds 5 MB.");
  const a = await SupportAttachment.create({ userId: req.user._id, name, contentType, size: bytes.length, data: bytes, expiresAt: new Date(Date.now() + 86400000) }); res.status(201).json({ attachment: { _id: a._id, name: a.name, contentType: a.contentType, size: a.size } });
}));
supportRouter.get("/attachments/:id/download", wrap(async (req: any, res: any) => {
  const a = await SupportAttachment.findById(id.parse(req.params.id)).select("+data"); if (!a) fail("Attachment not found", 404);
  if (a!.ticketId) { const ticket = await SupportTicket.findOne({ _id: a!.ticketId, ...(!isSupport(req.user) ? { userId: req.user._id } : {}) }); if (!ticket) fail("Attachment not found", 404); } else if (String(a!.userId) !== String(req.user._id) || !a!.expiresAt || a!.expiresAt < new Date()) fail("Attachment not found", 404);
  res.set({ "Content-Type": a!.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename="${String(a!.name).replace(/[^\x20-\x7e]|["\\]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox" }); res.send(a!.data);
}));
