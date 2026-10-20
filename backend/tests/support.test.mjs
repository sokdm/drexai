import {AdminSession} from '../dist/models/Admin.js';
import argon2 from "argon2";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Server } from "socket.io";
import { io as client } from "socket.io-client";
import { setRealtimeServer } from "../dist/realtime.js";
import { supportRouter } from "../dist/routes/support.js";
import { feedbackRouter } from "../dist/routes/feedback.js";
import { notificationsRouter } from "../dist/routes/notifications.js";
import { accountRouter } from "../dist/routes/account.js";
import { SupportTicket } from "../dist/models/SupportTicket.js";
import { SupportMessage } from "../dist/models/SupportMessage.js";
import { SupportAttachment } from "../dist/models/SupportAttachment.js";
import { SupportEmail } from "../dist/models/SupportEmail.js";
import { Feedback } from "../dist/models/Feedback.js";
import { Notification, NotificationCursor } from "../dist/models/Notification.js";
import { ImageGenerationJob } from "../dist/models/ImageGenerationJob.js";
import { LedgerEntry } from "../dist/models/LedgerEntry.js";
import { User } from "../dist/models/User.js";
import { Session } from "../dist/models/Session.js";
import { hashSecret } from "../dist/utils/crypto.js";
import { errorHandler } from "../dist/middleware/errorHandler.js";
import { env } from "../dist/config/env.js";
import { deliverSupportEmails, queueSupportEmail } from "../dist/services/supportEmail.js";
import { captureNotifications } from "../dist/workers/notificationWorker.js";
let db, server, io, base, user, stranger, admin, ticket, attachmentId, replyId, userSocket, adminSocket;
const originalFetch = globalThis.fetch, delivered = new Map(), requests = [], state = { dropped: false };
const headers = token => ({ Cookie: `drex_session=${token}`, "x-csrf-token": "csrf", "Content-Type": "application/json" });
const jsonPost = body => ({ method: "POST", body: JSON.stringify(body) });
async function request(path, token = "user", options = {}) { const r = await fetch(base + path, { ...options, headers: { ...headers(token), ...options.headers } }); return { status: r.status, data: await r.json() }; }
before(async () => {
  env.SMTP_HOST = undefined; env.SMTP_USER = undefined; env.SMTP_PASS = undefined;
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }], binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("drex_phase12"));
  for (const m of [SupportTicket, SupportMessage, SupportAttachment, SupportEmail, Feedback, Notification, NotificationCursor, LedgerEntry]) await m.init();
  for (const [token, role] of [["user", "user"], ["stranger", "user"], ["admin", "admin"], ["agent", "support"]]) {
    const u = await User.create({ displayName: token, email: `${token}@example.test`, passwordHash: "test", role, status: "active" });
    await Session.create({ userId: u._id, tokenHash: hashSecret(token), csrfTokenHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 3600000) });
    if (token === "user") user = u; if (token === "stranger") stranger = u; if (token === "admin") admin = u;
  }
  const app = express(); app.use(express.json(), cookieParser()); app.use("/support", supportRouter); app.use("/feedback", feedbackRouter); app.use("/notifications", notificationsRouter); app.use("/account", accountRouter); app.use(errorHandler);
  server = createServer(app); io = new Server(server, { cors: { origin: env.CLIENT_ORIGIN, credentials: true } }); setRealtimeServer(io);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}`;
  env.RESEND_API_KEY = "test-resend-key";
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith(base)) return originalFetch(url, options);
    assert.equal(String(url), "https://api.resend.com/emails"); assert.equal(options.headers.Authorization, "Bearer test-resend-key");
    const key = options.headers["Idempotency-Key"]; requests.push(key); assert.ok(key);
    if (!delivered.has(key)) delivered.set(key, { id: `email-${delivered.size}`, body: JSON.parse(options.body) });
    if (state.dropped) { state.dropped = false; throw new Error("Response lost after acceptance"); }
    return Response.json({ id: delivered.get(key).id });
  };
});
after(async () => { userSocket?.disconnect(); adminSocket?.disconnect(); globalThis.fetch = originalFetch; await new Promise(resolve => io?.close(resolve)); server?.closeAllConnections(); await mongoose.disconnect(); await db?.stop(); });
function socket(token, csrf = "csrf", origin = env.CLIENT_ORIGIN) { return client(base, { transports: ["websocket"], forceNew: true, reconnection: false, extraHeaders: { Cookie: `drex_session=${token}`, Origin: origin }, auth: { csrf } }); }
function once(socket, name) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Missing socket event ${name}`)), 5000); socket.once(name, v => { clearTimeout(timer); resolve(v); }); }); }
test("support authorization, categories and attachment byte validation are real", async () => {
  assert.equal((await originalFetch(base + "/support/config")).status, 401);
  assert.equal((await request("/support/config")).data.categories.length, 8);
  assert.equal((await request("/support/tickets?admin=true")).status, 403); assert.equal((await request("/support/agents")).status, 403);
  assert.equal((await request("/support/attachments", "user", { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.from("not a PNG") })).status, 400);
  assert.equal((await request("/support/attachments", "user", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: Buffer.from("not a PDF") })).status, 400);
  const uploaded = await request("/support/attachments", "user", { method: "POST", headers: { "Content-Type": "text/plain", "x-file-name": "diagnostic.txt" }, body: Buffer.from("A safe UTF-8 diagnostic") }); assert.equal(uploaded.status, 201); attachmentId = uploaded.data.attachment._id;
  assert.ok(!JSON.stringify(uploaded.data).includes("A safe")); assert.equal((await originalFetch(base + `/support/attachments/${attachmentId}/download`, { headers: headers("stranger") })).status, 404);
});
test("ticket creation, first message and attachments commit together and retry without duplication", async () => {
  const body = { subject: "Missing purchased credits", category: "Missing credits", content: "My payment completed but credits are missing.", attachments: [attachmentId], requestId: randomUUID() };
  const created = await request("/support/tickets", "user", jsonPost(body)); assert.equal(created.status, 201); ticket = created.data.ticket;
  const again = await request("/support/tickets", "user", jsonPost(body)); assert.equal(again.data.ticket._id, ticket._id); assert.equal(await SupportMessage.countDocuments({ ticketId: ticket._id }), 1); assert.equal(await SupportEmail.countDocuments({ ticketId: ticket._id }), 1);
  const a = await SupportAttachment.findById(attachmentId); assert.equal(String(a.ticketId), ticket._id); assert.equal(a.expiresAt, undefined);
  const detail = await request(`/support/tickets/${ticket._id}`); assert.equal(detail.data.messages[0].attachments[0].name, "diagnostic.txt"); assert.ok(!JSON.stringify(detail.data).includes("diagnostic\":{\"data"));
  const download = await originalFetch(base + `/support/attachments/${attachmentId}/download`, { headers: headers("admin") }); assert.equal(await download.text(), "A safe UTF-8 diagnostic"); assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.equal((await request(`/support/tickets/${ticket._id}`, "stranger")).status, 404);
  assert.equal((await request(`/support/tickets/${ticket._id}/messages`, "stranger", jsonPost({ content: "No access", requestId: randomUUID() }))).status, 404);
  assert.equal((await request(`/support/tickets/${ticket._id}`, "user", { method: "PATCH", body: JSON.stringify({ revision: 1, status: "resolved" }) })).status, 403);
});
test("Socket.IO rejects forged sessions, CSRF and origins; admin replies are stored before broadcast", async () => {
  for (const options of [["fake"], ["user", "bad"], ["user", "csrf", "https://attacker.example"]]) { const bad = socket(...options); const error = await once(bad, "connect_error"); assert.ok(error); bad.disconnect(); }
  userSocket = socket("user"); adminSocket = socket("admin"); await Promise.all([once(userSocket, "connect"), once(adminSocket, "connect")]);
  const event = once(userSocket, "support:changed"), body = { content: "We have checked your transaction and are reviewing it.", requestId: randomUUID() };
  const result = await request(`/support/tickets/${ticket._id}/messages`, "admin", jsonPost(body)); assert.equal(result.status, 201); replyId = result.data.message._id;
  assert.equal((await event).ticketId, ticket._id); assert.ok(await SupportMessage.exists({ _id: replyId }));
  await request(`/support/tickets/${ticket._id}/messages`, "admin", jsonPost(body)); assert.equal(await SupportMessage.countDocuments({ ticketId: ticket._id }), 2); assert.equal(await Notification.countDocuments({ eventKey: `support-reply:${replyId}` }), 1);
  assert.equal((await request("/notifications", "user")).data.unread, 1); assert.equal((await request("/notifications", "stranger")).data.unread, 0);
});
test("read receipts, reconnect recovery, assignment, priority and literal ticket search work", async () => {
  const read = once(adminSocket, "support:changed"); await request(`/support/tickets/${ticket._id}/read`, "user", jsonPost({ through: replyId })); await read; assert.ok((await SupportMessage.findById(replyId)).readByUserAt);
  userSocket.disconnect(); userSocket.connect(); await once(userSocket, "connect"); const d = await request(`/support/tickets/${ticket._id}`); assert.equal(d.data.messages.length, 2);
  const updated = await request(`/support/tickets/${ticket._id}`, "admin", { method: "PATCH", body: JSON.stringify({ revision: d.data.ticket.revision, assignedTo: String(admin._id), priority: "high" }) }); assert.equal(updated.status, 200); assert.equal(updated.data.ticket.priority, "high");
  assert.equal((await request("/support/tickets?admin=true&search=Missing&priority=high", "agent")).data.tickets.length, 1); assert.equal((await request("/support/tickets?admin=true&search=.*", "admin")).data.tickets.length, 0);
  const stale = await request(`/support/tickets/${ticket._id}`, "admin", { method: "PATCH", body: JSON.stringify({ revision: d.data.ticket.revision, priority: "low" }) }); assert.equal(stale.status, 409);
});
test("resolution preserves history, queues one notice and eligible users can reopen", async () => {
  const t = (await request(`/support/tickets/${ticket._id}`)).data.ticket;
  const result = await request(`/support/tickets/${ticket._id}`, "agent", { method: "PATCH", body: JSON.stringify({ revision: t.revision, status: "resolved" }) }); assert.equal(result.status, 200);
  assert.equal((await request(`/support/tickets/${ticket._id}`)).data.canReopen, true);
  assert.equal((await request(`/support/tickets/${ticket._id}/messages`, "user", jsonPost({ content: "Another message", requestId: randomUUID() }))).status, 409);
  assert.equal((await request(`/support/tickets/${ticket._id}/reopen`, "user", jsonPost({}))).status, 200); assert.equal(await SupportMessage.countDocuments({ ticketId: ticket._id }), 2);
  await SupportTicket.updateOne({ _id: ticket._id }, { status: "resolved", resolvedAt: new Date(Date.now() - 31 * 86400000) }); assert.equal((await request(`/support/tickets/${ticket._id}/reopen`, "user", jsonPost({}))).status, 409); assert.equal((await request(`/support/tickets/${ticket._id}/reopen`, "admin", jsonPost({}))).status, 200);
  assert.ok((await SupportTicket.findById(ticket._id)).history.length >= 4);
});
test("Resend outbox deduplicates retries and never treats missing configuration as delivery", async () => {
  assert.equal(await SupportEmail.countDocuments({ ticketId: ticket._id }), 3);
  env.RESEND_API_KEY = undefined; await deliverSupportEmails(); assert.equal(delivered.size, 0); env.RESEND_API_KEY = "test-resend-key";
  state.dropped = true; await deliverSupportEmails(); assert.equal(delivered.size, 3); const pending = await SupportEmail.findOne({ status: "pending" }); assert.ok(pending); await SupportEmail.updateOne({ _id: pending._id }, { nextAttemptAt: new Date(0) });
  await Promise.all([deliverSupportEmails(), deliverSupportEmails()]); assert.equal(delivered.size, 3); assert.equal(await SupportEmail.countDocuments({ status: "sent" }), 3); assert.equal(requests.filter(k => k === `drex-support-${pending._id}`).length, 2);
  await deliverSupportEmails(); assert.equal(delivered.size, 3);
});
test("notification ownership, read state, preferences and support email opt-out are persisted", async () => {
  const n = await Notification.findOne({ userId: user._id }); await request("/notifications/read", "stranger", jsonPost({ ids: [String(n._id)] })); assert.equal((await Notification.findById(n._id)).readAt, undefined);
  await request("/notifications/read", "user", jsonPost({ ids: [String(n._id)] })); assert.ok((await Notification.findById(n._id)).readAt);
  assert.equal((await request("/notifications/preferences", "user", { method: "PATCH", body: JSON.stringify({ supportEmails: false, generationNotifications: false, marketingEmails: false }) })).status, 200);
  await queueSupportEmail(user._id, ticket._id, "optout-test", "Optional support update", "No delivery expected"); await deliverSupportEmails(); assert.equal((await SupportEmail.findOne({ eventKey: "optout-test" })).status, "skipped"); assert.equal(delivered.size, 3);
});
test("terminal generation and settled purchase events produce durable deduplicated notifications", async () => {
  await User.updateOne({ _id: user._id }, { "preferences.generationNotifications": true });
  await ImageGenerationJob.create({ userId: user._id, model: "test-image", prompt: "Original test image", status: "completed", aspectRatio: "16:9", resolution: "1K", numberOfImages: 1 });
  await ImageGenerationJob.create({ userId: user._id, model: "test-image", prompt: "Failed image", status: "failed", aspectRatio: "16:9", resolution: "1K", numberOfImages: 1 });
  await LedgerEntry.create({ userId: user._id, walletId: new mongoose.Types.ObjectId(), type: "purchase", amountCredits: 100, balanceAfter: 100, idempotencyKey: "test-purchase" });
  await captureNotifications(); await captureNotifications(); assert.equal(await Notification.countDocuments({ userId: user._id, type: "generation" }), 2); assert.equal(await Notification.countDocuments({ userId: user._id, type: "purchase" }), 1);
  await User.updateOne({ _id: user._id }, { passwordHash: await argon2.hash("PreviousPassword123") });
  assert.equal((await request("/account/password", "user", { method: "PATCH", body: JSON.stringify({ currentPassword: "PreviousPassword123", password: "NewPassword1234", confirmPassword: "NewPassword1234" }) })).status, 200);
  assert.ok(await Notification.findOne({ userId: user._id, title: "Password changed" }));
  await request("/account/deletion-request", "user", jsonPost({})); assert.equal(await Notification.countDocuments({ userId: user._id, type: "account" }), 2);
});
test("feedback stores ratings, protects admin review and hides internal notes from customers", async () => {
  const input = { type: "experience", subject: "Editing experience", content: "The editor is useful; clearer timing would help.", rating: 4, requestId: randomUUID() };
  const r = await request("/feedback", "user", jsonPost(input)); assert.equal(r.status, 201); await request("/feedback", "user", jsonPost(input)); assert.equal(await Feedback.countDocuments({ userId: user._id }), 1);
  assert.equal((await request("/feedback/admin", "user")).status, 403); assert.equal((await request("/feedback", "stranger")).data.feedback.length, 0);
  const reviewed = await request(`/feedback/${r.data.feedback._id}`, "admin", { method: "PATCH", body: JSON.stringify({ category: "Editor UX", status: "reviewed", adminNote: "Internal team context" }) }); assert.equal(reviewed.status, 200); assert.equal(reviewed.data.feedback.category, "Editor UX");
  assert.ok(!JSON.stringify((await request("/feedback")).data).includes("Internal team context"));
  assert.equal((await request("/feedback", "user", jsonPost({ ...input, requestId: randomUUID(), rating: 7 }))).status, 400);
  assert.equal((await request("/feedback", "user", { ...jsonPost(input), headers: { "x-csrf-token": "wrong" } })).status, 403);
});

test('separate administrator sessions authenticate live support sockets and reject forged CSRF',async()=>{await AdminSession.create({userId:admin._id,tokenHash:hashSecret('admin-live'),csrfHash:hashSecret('admin-live-csrf'),expiresAt:new Date(Date.now()+60000)});const connect=csrf=>client(base,{transports:['websocket'],extraHeaders:{Origin:env.CLIENT_ORIGIN,Cookie:'drex_admin=admin-live'},auth:{scope:'admin',csrf},forceNew:true,reconnection:false});const good=connect('admin-live-csrf');try{await new Promise((resolve,reject)=>{good.once('connect',resolve);good.once('connect_error',reject);});const bad=connect('forged');try{await new Promise((resolve,reject)=>{bad.once('connect_error',resolve);bad.once('connect',()=>reject(Error('Forged CSRF accepted')));});}finally{bad.disconnect();}}finally{good.disconnect();}});
