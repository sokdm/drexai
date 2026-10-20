import {turnstileConfig,turnstileGuard} from '../services/turnstile.js';
import { verifyPassword } from "../utils/password.js";
import { notify } from "../services/notifications.js";
import argon2 from "argon2";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { EmailVerification } from "../models/EmailVerification.js";
import { PasswordReset } from "../models/PasswordReset.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { sendPasswordResetEmail, sendVerificationEmail, sendWelcomeEmail } from "../services/email.js";
import { createOtp, hashSecret, randomToken } from "../utils/crypto.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { ensureWallet } from "../services/wallet.js";

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });

const emailSchema = z.string().email().transform((email) => email.toLowerCase());
const passwordSchema = z.string().min(10).regex(/[A-Z]/, "Use at least one uppercase letter").regex(/[a-z]/, "Use at least one lowercase letter").regex(/[0-9]/, "Use at least one number");
const registerSchema = z.object({
  name: z.string().min(2).max(80),
  country: z.string().min(2).max(80),
  inviteCode: z.string().max(80).optional().or(z.literal("")),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "You must agree to the Drex Terms of Service" }) }),
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });
authRouter.get("/security",(_req,res)=>res.json(turnstileConfig()));
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });
const otpSchema = z.object({ email: emailSchema, code: z.string().length(6) });
const resetSchema = z.object({ email: emailSchema, code: z.string().length(6), password: passwordSchema, confirmPassword: z.string() }).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" });

function publicUser(user: any) {
  return {
    id: user._id,
    displayName: user.displayName,
    email: user.email,
    country: user.country,
    profilePictureUrl: user.profilePictureUrl,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    onboarding: user.onboarding,
    preferences: user.preferences,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  };
}

async function createVerification(userId: string, email: string) {
  const code = createOtp();
  await EmailVerification.deleteMany({ userId, consumedAt: null });
  await EmailVerification.create({
    userId,
    codeHash: hashSecret(code),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    resendAvailableAt: new Date(Date.now() + 60 * 1000)
  });
  await sendVerificationEmail(email, code);
}

async function issueSession(user: any, req: any, res: any) {
  const token = randomToken();
  const csrf = randomToken(16);
  await Session.create({
    userId: user._id,
    tokenHash: hashSecret(token),
    csrfTokenHash: hashSecret(csrf),
    userAgent: req.get("user-agent"),
    ip: req.ip,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
  });
  res.cookie("drex_session", token, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 1000 * 60 * 60 * 24 * 14 });
  res.cookie("drex_csrf", csrf, { httpOnly: false, sameSite: "lax", secure: false, maxAge: 1000 * 60 * 60 * 24 * 14 });
  return csrf;
}

authRouter.use(authLimiter);

authRouter.post("/register", strictLimiter,turnstileGuard("signup"), async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const existing = await User.findOne({ email: input.email });
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });
    const user = await User.create({ displayName: input.name, country: input.country, inviteCode: input.inviteCode || undefined, termsAcceptedAt: new Date(), email: input.email, passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }) });
    await ensureWallet(String(user._id));
    await createVerification(String(user._id), user.email);
    res.status(201).json({ message: "Account created. Check your email for the verification code.", email: user.email });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/verify-email", strictLimiter, async (req, res, next) => {
  try {
    const input = otpSchema.parse(req.body);
    const user = await User.findOne({ email: input.email });
    if (!user) return res.status(400).json({ error: "Invalid or expired code" });
    const record = await EmailVerification.findOne({ userId: user._id, consumedAt: null }).sort({ createdAt: -1 });
    if (!record || record.expiresAt < new Date()) return res.status(400).json({ error: "Invalid or expired code" });
    if (record.attempts >= 5) return res.status(429).json({ error: "Too many failed attempts. Request a new code." });
    if (record.codeHash !== hashSecret(input.code)) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ error: "Invalid or expired code" });
    }
    record.consumedAt = new Date();
    user.emailVerified = true;
    user.status = "active";
    await record.save();
    if (!user.welcomeEmailSentAt) {
      await sendWelcomeEmail(user.email, user.displayName);
      user.welcomeEmailSentAt = new Date();
    }
    user.lastLoginAt = new Date();
    await user.save();
    const csrfToken = await issueSession(user, req, res);
    res.json({ user: publicUser(user), csrfToken });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/resend-verification", strictLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const user = await User.findOne({ email });
    if (user && !user.emailVerified) {
      const latest = await EmailVerification.findOne({ userId: user._id, consumedAt: null }).sort({ createdAt: -1 });
      if (!latest || latest.resendAvailableAt <= new Date()) await createVerification(String(user._id), user.email);
    }
    res.json({ message: "If the account needs verification, a new code will be sent when allowed." });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", strictLimiter,turnstileGuard("login"), async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await User.findOne({ email: input.email });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) return res.status(401).json({ error: "Invalid email or password" });
    if (user.status === "suspended") return res.status(403).json({ error: "Account suspended" });
    if (!user.emailVerified) return res.status(403).json({ error: "Email verification required", needsVerification: true, email: user.email });
    user.lastLoginAt = new Date();
    await user.save();
    const csrfToken = await issueSession(user, req, res);
    res.json({ user: publicUser(user), csrfToken });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/forgot-password", strictLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const user = await User.findOne({ email });
    if (user) {
      const code = createOtp();
      await PasswordReset.create({ userId: user._id, codeHash: hashSecret(code), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
      await sendPasswordResetEmail(user.email, code);
    }
    res.json({ message: "If an account exists, a reset code has been sent." });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/reset-password", strictLimiter, async (req, res, next) => {
  try {
    const input = resetSchema.parse(req.body);
    const user = await User.findOne({ email: input.email });
    const record = user ? await PasswordReset.findOne({ userId: user._id, consumedAt: null }).sort({ createdAt: -1 }) : null;
    if (!user || !record || record.expiresAt < new Date() || record.attempts >= 5) return res.status(400).json({ error: "Invalid or expired reset code" });
    if (record.codeHash !== hashSecret(input.code)) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }
    user.passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    record.consumedAt = new Date();
    await Promise.all([user.save(), record.save(), Session.updateMany({ userId: user._id }, { revokedAt: new Date() })]);
    await notify({ userId: user._id, eventKey: `password-reset:${record._id}`, type: "account", title: "Password reset completed", content: "Your password was reset and existing sessions were revoked. Contact support if you did not request this.", href: "/dashboard/support" });
    res.json({ message: "Password updated. Please log in again." });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.cookies?.drex_csrf }));

authRouter.post("/logout", requireAuth, requireCsrf, async (req, res) => {
  if (req.sessionDoc) {
    req.sessionDoc.revokedAt = new Date();
    await req.sessionDoc.save();
  }
  res.clearCookie("drex_session");
  res.clearCookie("drex_csrf");
  res.json({ message: "Logged out" });
});
