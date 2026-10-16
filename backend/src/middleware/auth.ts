import type { NextFunction, Request, Response } from "express";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { hashSecret } from "../utils/crypto.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if ((req as any).adminUser) { req.user = (req as any).adminUser; return next(); }
  const token = req.cookies?.drex_session;
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const session = await Session.findOne({ tokenHash: hashSecret(token), revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session) return res.status(401).json({ error: "Session expired" });
  const user = await User.findById(session.userId).select("-passwordHash");
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (user.status === "suspended") return res.status(403).json({ error: "Account suspended" });
  req.sessionDoc = session;
  req.user = user;
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if ((req as any).adminUser) return next();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const csrf = req.headers["x-csrf-token"];
  if (!req.sessionDoc || typeof csrf !== "string" || hashSecret(csrf) !== req.sessionDoc.csrfTokenHash) {
    return res.status(403).json({ error: "Security check failed. Refresh and try again." });
  }
  next();
}
