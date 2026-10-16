import argon2 from "argon2";
import mongoose from "mongoose";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AdminBootstrap, AdminSession } from "../models/Admin.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { hashSecret } from "../utils/crypto.js";
export async function bootstrapAdmin() {
  if (!env.ADMIN_BOOTSTRAP_ENABLED || await AdminBootstrap.exists({ _id: "initial-admin" })) return;
  if (!env.ADMIN_BOOTSTRAP_PASSWORD_HASH && env.ADMIN_BOOTSTRAP_PASSWORD) env.ADMIN_BOOTSTRAP_PASSWORD_HASH = await argon2.hash(env.ADMIN_BOOTSTRAP_PASSWORD, { type: argon2.argon2id });
  delete env.ADMIN_BOOTSTRAP_PASSWORD; delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!env.ADMIN_BOOTSTRAP_EMAIL || !env.ADMIN_BOOTSTRAP_PASSWORD_HASH?.startsWith("$argon2id$")) throw new Error("Admin bootstrap requires an email and Argon2id password hash.");
  // Parse/validate the hash without needing or storing its plaintext password.
  await argon2.verify(env.ADMIN_BOOTSTRAP_PASSWORD_HASH, "bootstrap-hash-validation");
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
    if (await AdminBootstrap.exists({ _id: "initial-admin" }).session(session)) return;
    if (await User.exists({ role: "admin" }).session(session)) throw new Error("Bootstrap refused: an administrator already exists.");
    if (await User.exists({ email: env.ADMIN_BOOTSTRAP_EMAIL }).session(session)) throw new Error("Bootstrap refuses to promote an existing account. Use an unused administrator email.");
    await User.create([{ email: env.ADMIN_BOOTSTRAP_EMAIL, passwordHash: env.ADMIN_BOOTSTRAP_PASSWORD_HASH, displayName: "Platform administrator", role: "admin", status: "active", emailVerified: true }], { session });
    await AdminBootstrap.create([{ _id: "initial-admin", email: env.ADMIN_BOOTSTRAP_EMAIL, completedAt: new Date() }], { session });
  }); } finally { await session.endSession(); }
}
export function totp(secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, "")) { const i = alphabet.indexOf(char); if (i < 0) throw new Error("Invalid TOTP secret"); bits += i.toString(2).padStart(5, "0"); }
  const key = Buffer.from((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2))); const step = Buffer.alloc(8); step.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const digest = createHmac("sha1", key).update(step).digest(), offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
export function verifiedTotpStep(code: string): number | null { if (!env.ADMIN_TOTP_SECRET || !/^\d{6}$/.test(code)) return null; const now = Math.floor(Date.now() / 30000); for (const delta of [-1, 0, 1]) { const step = now + delta; if (timingSafeEqual(Buffer.from(code), Buffer.from(totp(env.ADMIN_TOTP_SECRET, step * 30000)))) return step; } return null; }
export function checkTotp(code: string) { return verifiedTotpStep(code) !== null; }
export async function adminIdentity(req: any) { const raw = req.cookies?.drex_admin; if (!raw) return null; const session = await AdminSession.findOne({ tokenHash: hashSecret(raw), revokedAt: null, expiresAt: { $gt: new Date() } }); const user = session ? await User.findOne({ _id: session.userId, role: "admin", status: "active" }).select("displayName email role") : null; return user ? { user, session } : null; }
export async function requireAdmin(req: any, res: any, next: any) { try { const found = await adminIdentity(req); if (!found) return res.status(401).json({ error: "Administrator sign-in required" }); if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && hashSecret(String(req.headers["x-admin-csrf"] || "")) !== found.session!.csrfHash) return res.status(403).json({ error: "Admin security check failed" }); req.adminUser = found.user; req.adminSession = found.session; next(); } catch (e) { next(e); } }
