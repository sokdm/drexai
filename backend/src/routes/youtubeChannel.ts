import { Router, raw, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { YouTubeUpload } from "../models/YouTubeUpload.js";
import { ownConnection, myChannel, createUpload, refreshUpload, uploadChunk, publicUpload, publishError, setThumbnail } from "../services/youtubePublishing.js";

export const youtubeChannelRouter = Router();
youtubeChannelRouter.use(requireAuth, requireCsrf);
const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
youtubeChannelRouter.get("/my-channel", wrap(async (req, res) => { const pageToken = z.string().max(1000).optional().parse(req.query.pageToken); res.json(await myChannel(String(req.user._id), pageToken)); }));
youtubeChannelRouter.get("/uploads", wrap(async (req, res) => { const connection = await ownConnection(String(req.user._id)); const uploads = await YouTubeUpload.find({ userId: req.user._id, channelId: connection.channelId }).sort({ createdAt: -1 }).limit(30); res.json({ uploads: uploads.map(publicUpload) }); }));
youtubeChannelRouter.post("/uploads", rateLimit({ windowMs: 15 * 60000, limit: 10 }), wrap(async (req, res) => { res.status(201).json({ upload: publicUpload(await createUpload(String(req.user._id), req.body)) }); }));
youtubeChannelRouter.get("/uploads/:id", wrap(async (req, res) => { res.json({ upload: publicUpload(await refreshUpload(String(req.user._id), z.string().parse(req.params.id))) }); }));
youtubeChannelRouter.put("/uploads/:id/chunk", raw({ type: ["application/octet-stream", "video/*"], limit: "8mb" }), wrap(async (req, res) => { const offset = z.coerce.number().int().nonnegative().parse(req.headers["x-upload-offset"]); const job = await uploadChunk(String(req.user._id), z.string().parse(req.params.id), offset, req.body); if (!job) publishError("Upload not found.", 404); res.json({ upload: publicUpload(job) }); }));
youtubeChannelRouter.post("/my-videos/:videoId/thumbnail", rateLimit({ windowMs: 60000, limit: 10 }), raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "10mb" }), wrap(async (req, res) => { res.json(await setThumbnail(String(req.user._id), z.string().parse(req.params.videoId), req.body)); }));
