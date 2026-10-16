import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { Feedback } from "../models/Feedback.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { requireSupport } from "./support.js";
export const feedbackRouter = Router(); feedbackRouter.use(requireAuth, requireCsrf);
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
const id = z.string().regex(/^[a-f\d]{24}$/i);
feedbackRouter.post("/", rateLimit({ windowMs: 3600000, limit: 15 }), wrap(async (req: any, res: any) => {
  const input = z.object({ type: z.enum(["bug", "feature", "general", "experience"]), subject: z.string().trim().min(3).max(150), content: z.string().trim().min(3).max(10000), rating: z.number().int().min(1).max(5).optional(), requestId: z.string().uuid() }).refine(v => v.type !== "experience" || !!v.rating, "Choose an experience rating.").parse(req.body);
  const feedback = await Feedback.findOneAndUpdate({ userId: req.user._id, requestId: input.requestId }, { $setOnInsert: { ...input, userId: req.user._id } }, { upsert: true, new: true }); res.status(201).json({ feedback });
}));
feedbackRouter.get("/", wrap(async (req: any, res: any) => { res.json({ feedback: await Feedback.find({ userId: req.user._id }).select("-adminNote").sort({ createdAt: -1 }).limit(50) }); }));
feedbackRouter.get("/admin", requireSupport, wrap(async (req: any, res: any) => { const input = z.object({ type: z.enum(["bug", "feature", "general", "experience"]).optional(), status: z.enum(["new", "reviewed", "planned", "closed"]).optional(), before: id.optional() }).parse(req.query); const { before, ...filters } = input; const feedback = await Feedback.find({ ...filters, ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(31); res.json({ feedback: feedback.slice(0, 30), next: feedback.length > 30 ? String(feedback[29]._id) : null }); }));
feedbackRouter.patch("/:id", requireSupport, wrap(async (req: any, res: any) => { const data = z.object({ category: z.string().trim().min(1).max(100).optional(), status: z.enum(["new", "reviewed", "planned", "closed"]).optional(), adminNote: z.string().max(3000).optional() }).parse(req.body); const feedback = await Feedback.findByIdAndUpdate(id.parse(req.params.id), { $set: data }, { new: true }); if (!feedback) return res.status(404).json({ error: "Feedback not found" }); res.json({ feedback }); }));
