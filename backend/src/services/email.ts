import mongoose from "mongoose";
import { EmailDelivery, EmailTemplate } from "../models/Finance.js";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { brand } from "@drex/shared";
import { env } from "../config/env.js";

export function smtpConfigured() { return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS); }
export function emailConfigured() { return smtpConfigured() || Boolean(env.RESEND_API_KEY); }
async function deliverTransactionalEmail(to: string, subject: string, text: string, eventKey: string, html?: string) {
  if (smtpConfigured()) {
    const transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
    const result = await transporter.sendMail({ from: env.EMAIL_FROM, to, subject, text, ...(html ? { html } : {}), messageId: '<' + eventKey.replace(/[^a-zA-Z0-9._-]/g, '-') + '@drex.mail>' });
    if (!result.accepted?.length || result.rejected?.length) throw new Error("SMTP did not accept the recipient");
    return { messageId: String(result.messageId), provider: "smtp" };
  }
  if (!env.RESEND_API_KEY) throw new Error("Email delivery is not configured");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": eventKey }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }), signal: AbortSignal.timeout(20000) });
  const data = await response.json() as any;
  if (!response.ok || !data.id) throw new Error("Email provider did not accept the message");
  return { messageId: String(data.id), provider: "resend" };
}
export async function sendTransactionalEmail(to: string, subject: string, text: string, eventKey: string, html?: string) {
  try { const result = await deliverTransactionalEmail(to, subject, text, eventKey, html); if (mongoose.connection.readyState === 1) await EmailDelivery.create({ eventKey, recipient: to, subject, status: "accepted", provider: result.provider }).catch(() => {}); return result; }
  catch (error) { if (mongoose.connection.readyState === 1) await EmailDelivery.create({ eventKey, recipient: to, subject, status: "failed", error: "Email transport failed. Check SMTP/provider configuration and server logs." }).catch(() => {}); throw error; }
}
async function sendEmail(to: string, subject: string, html: string) {
  return sendTransactionalEmail(to, subject, html.replace(/<[^>]+>/g, " "), 'account-' + randomUUID(), html);
}

function shell(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f7f8fb;font-family:Arial,sans-serif;color:#111318"><div style="max-width:560px;margin:0 auto;padding:32px"><div style="font-size:24px;font-weight:900;margin-bottom:20px">${brand.name}</div><div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:28px"><h1 style="margin:0 0 12px;font-size:24px">${title}</h1>${body}</div><p style="font-size:12px;color:#64748b;margin-top:18px">This email was sent by ${brand.name}. If you did not request it, you can ignore it.</p></div></body></html>`;
}

export function sendVerificationEmail(email: string, code: string) {
  return sendEmail(email, `Verify your ${brand.name} account`, shell("Verify your email", `<p>Your verification code is:</p><p style="font-size:32px;font-weight:900;letter-spacing:6px">${code}</p><p>This code expires in 15 minutes.</p>`));
}

export function sendPasswordResetEmail(email: string, code: string) {
  return sendEmail(email, `Reset your ${brand.name} password`, shell("Reset your password", `<p>Use this code to reset your password:</p><p style="font-size:32px;font-weight:900;letter-spacing:6px">${code}</p><p>This code expires in 15 minutes.</p>`));
}

export async function sendWelcomeEmail(email: string, displayName: string) {
  const template = mongoose.connection.readyState === 1 ? await EmailTemplate.findById("welcome").lean() : null;
  if (template) return sendTransactionalEmail(email, template.subject!.replaceAll("{{name}}", displayName), template.body!.replaceAll("{{name}}", displayName), "welcome-" + randomUUID());
  return sendEmail(email, `Welcome to ${brand.name}`, shell(`Welcome, ${displayName}`, `<p>${brand.name} helps you organize YouTube research, scripts, AI tools, studio workflows, projects, and support from one dashboard.</p><p><a href="${env.APP_URL}/dashboard" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 16px;border-radius:6px;text-decoration:none;font-weight:700">Open dashboard</a></p>`));
}
