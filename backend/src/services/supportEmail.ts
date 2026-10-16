import { emailConfigured, smtpConfigured, sendTransactionalEmail } from "./email.js";
import { SupportEmail } from "../models/SupportEmail.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";

export async function queueSupportEmail(userId: any, ticketId: any, eventKey: string, subject: string, text: string, session?: any) {
  await SupportEmail.updateOne({ eventKey }, { $setOnInsert: { userId, ticketId, eventKey, subject, text: `${text}\n\nView your conversation: ${env.APP_URL}/dashboard/support?ticket=${ticketId}` } }, { upsert: true, session });
}
export async function deliverSupportEmails() {
  // No development fake-success delivery. Missing configuration leaves durable mail pending.
  if (!emailConfigured()) return;
  for (let i = 0; i < 20; i++) {
    const now = new Date();
    const mail = await SupportEmail.findOneAndUpdate({ $or: [{ status: "pending", nextAttemptAt: { $lte: now } }, { status: "sending", leaseUntil: { $lt: now } }] }, { $set: { status: "sending", leaseUntil: new Date(Date.now() + 90000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
    if (!mail) return;
    if (smtpConfigured() && mail.attempts > 1) { mail.status = "failed"; mail.error = "SMTP delivery is uncertain. Review mail-server records before resending to avoid duplicates."; await mail.save(); continue; }
    // Resend retains idempotency keys for 24h. Do not automatically retry uncertain deliveries beyond that window.
    if (mail.firstAttemptAt && Date.now() - mail.firstAttemptAt.getTime() > 23 * 3600000) { mail.status = "failed"; mail.error = "Delivery needs manual review after the safe retry window."; await mail.save(); continue; }
    const user = await User.findById(mail.userId);
    if (!user || user.preferences?.supportEmails === false) { mail.status = "skipped"; await mail.save(); continue; }
    if (!mail.firstAttemptAt) { mail.firstAttemptAt = now; await mail.save(); }
    try {
      const delivery = await sendTransactionalEmail(user.email, mail.subject || "Support update", mail.text || "View your support conversation in Drex.", 'drex-support-' + mail._id);
      mail.status = "sent"; mail.sentAt = new Date(); mail.providerId = delivery.messageId; mail.error = undefined;
    } catch { mail.status = smtpConfigured() || mail.attempts >= 10 ? "failed" : "pending"; mail.nextAttemptAt = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** mail.attempts)); mail.error = "Email delivery could not be confirmed. SMTP requires manual review; other retries retain their idempotency key."; }
    await mail.save();
  }
}
