import { verifyPassword } from "../utils/password.js";
import { notify } from "../services/notifications.js";
import { randomToken } from "../utils/crypto.js";
import argon2 from "argon2";
import { Router } from "express";
import { z } from "zod";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";

export const accountRouter = Router();
accountRouter.use(requireAuth, requireCsrf);

accountRouter.patch("/profile", async (req, res, next) => {
  try {
    const input = z.object({
      displayName: z.string().min(2).max(80).optional(),
      profilePictureUrl: z.string().url().optional().or(z.literal("")),
      preferences: z.object({ appearance: z.enum(["system", "light", "dark"]).optional(), emailUpdates: z.boolean().optional() }).optional()
    }).parse(req.body);
    if (input.displayName) req.user.displayName = input.displayName;
    if (input.profilePictureUrl !== undefined) req.user.profilePictureUrl = input.profilePictureUrl || undefined;
    if (input.preferences) req.user.preferences = { ...req.user.preferences, ...input.preferences };
    await req.user.save();
    res.json({ user: req.user });
  } catch (error) {
    next(error);
  }
});

accountRouter.patch("/password", async (req, res, next) => {
  try {
    const input = z.object({ currentPassword: z.string(), password: z.string().min(10), confirmPassword: z.string() }).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" }).parse(req.body);
    const credentials = await User.findById(req.user._id).select("passwordHash");
    if (!credentials || !(await verifyPassword(credentials.passwordHash, input.currentPassword))) return res.status(400).json({ error: "Current password is incorrect" });
    req.user.passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    await req.user.save();
    await notify({ userId: req.user._id, eventKey: `password:${req.user._id}:${randomToken(8)}`, type: "account", title: "Password changed", content: "Your account password was updated. Contact support if you did not make this change.", href: "/dashboard/settings" });
    res.json({ message: "Password changed" });
  } catch (error) {
    next(error);
  }
});

accountRouter.get("/sessions", async (req, res) => {
  const sessions = await Session.find({ userId: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).select("userAgent ip createdAt expiresAt");
  res.json({ sessions });
});

accountRouter.post("/deletion-request", async (req, res) => {
  req.user.status = "deletion_requested";
  await req.user.save();
  await notify({ userId: req.user._id, eventKey: `deletion:${req.user._id}`, type: "account", title: "Account deletion requested", content: "Contact support if you did not request account deletion.", href: "/dashboard/support" });
  res.json({ message: "Account deletion requested" });
});

accountRouter.patch("/onboarding", async (req, res, next) => {
  try {
    const input = z.object({ step: z.number().min(0).max(6).optional(), completed: z.boolean().optional(), skipped: z.boolean().optional(), restart: z.boolean().optional() }).parse(req.body);
    if (input.restart) req.user.onboarding = { completed: false, skipped: false, step: 0 };
    else {
      req.user.onboarding = {
        ...req.user.onboarding,
        step: input.step ?? req.user.onboarding?.step ?? 0,
        completed: input.completed ?? req.user.onboarding?.completed ?? false,
        skipped: input.skipped ?? req.user.onboarding?.skipped ?? false,
        completedAt: input.completed ? new Date() : req.user.onboarding?.completedAt
      };
    }
    await req.user.save();
    res.json({ onboarding: req.user.onboarding });
  } catch (error) {
    next(error);
  }
});
