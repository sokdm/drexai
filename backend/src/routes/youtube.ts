import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { YouTubeConnection } from "../models/YouTubeConnection.js";
import { ResearchCollection } from "../models/ResearchCollection.js";
import { SearchHistory } from "../models/SearchHistory.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";
import { exchangeCode, googleAuthUrl, popularVideos, resolveChannel, saveConnection, searchVideos, authorizedGet } from "../services/youtube.js";
import { randomToken } from "../utils/crypto.js";

export const youtubeRouter = Router();
const searchLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const oauthStates = new Map<string, { userId: string; expiresAt: number; publishing: boolean; commenting: boolean; videoId?: string }>();

youtubeRouter.use(requireAuth);

youtubeRouter.get("/config", async (req, res) => {
  const connection = await YouTubeConnection.findOne({ userId: req.user._id, disconnectedAt: null }).select("channelId channelTitle channelThumbnail scopes expiresAt updatedAt");
  res.json({ configured: Boolean(env.YOUTUBE_API_KEY), oauthConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), connection });
});

youtubeRouter.get("/search/videos", searchLimiter, async (req, res, next) => {
  try {
    const input = z.object({
      q: z.string().min(1),
      regionCode: z.string().length(2).optional(),
      relevanceLanguage: z.string().optional(),
      videoDuration: z.enum(["any", "short", "medium", "long"]).optional(),
      videoCategoryId: z.string().optional(),
      order: z.enum(["date", "rating", "relevance", "title", "videoCount", "viewCount"]).optional(),
      publishedAfter: z.string().optional(),
      publishedBefore: z.string().optional(),
      minViews: z.coerce.number().optional(),
      minLikes: z.coerce.number().optional(),
      minComments: z.coerce.number().optional(),
      pageToken: z.string().optional()
    }).parse(req.query);
    const result = await searchVideos(input);
    await SearchHistory.create({ userId: req.user._id, kind: "video", query: input, resultCount: result.items.length });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

youtubeRouter.get("/popular", searchLimiter, async (req, res, next) => {
  try {
    const result = await popularVideos(req.query);
    await SearchHistory.create({ userId: req.user._id, kind: "popular", query: req.query, resultCount: result.items.length });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

youtubeRouter.get("/channel", searchLimiter, async (req, res, next) => {
  try {
    const value = z.string().min(1).parse(req.query.value);
    const result = await resolveChannel(value);
    await SearchHistory.create({ userId: req.user._id, kind: "channel", query: { value }, resultCount: result.uploads.length });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

youtubeRouter.get("/collections", async (req, res) => {
  let collections = await ResearchCollection.find({ userId: req.user._id }).sort({ updatedAt: -1 });
  if (collections.length === 0) collections = [await ResearchCollection.create({ userId: req.user._id, name: "Saved Research" })];
  const history = await SearchHistory.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20);
  res.json({ collections, history });
});

youtubeRouter.post("/collections", requireCsrf, async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
    res.status(201).json({ collection: await ResearchCollection.create({ userId: req.user._id, name }) });
  } catch (error) {
    next(error);
  }
});

youtubeRouter.patch("/collections/:id", requireCsrf, async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
    const collection = await ResearchCollection.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { name }, { new: true });
    res.json({ collection });
  } catch (error) {
    next(error);
  }
});

youtubeRouter.post("/collections/:id/items", requireCsrf, async (req, res, next) => {
  try {
    const item = z.object({ itemType: z.enum(["video", "channel"]), youtubeId: z.string(), title: z.string().optional(), channelTitle: z.string().optional(), thumbnail: z.string().optional(), url: z.string().optional(), metadata: z.any().optional() }).parse(req.body);
    const collection = await ResearchCollection.findOneAndUpdate({ _id: req.params.id, userId: req.user._id, items: { $not: { $elemMatch: { itemType: item.itemType, youtubeId: item.youtubeId } } } }, { $push: { items: item } }, { new: true })
      ?? await ResearchCollection.findOne({ _id: req.params.id, userId: req.user._id });
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    res.json({ collection });
  } catch (error) {
    next(error);
  }
});

youtubeRouter.delete("/collections/:id/items/:itemId", requireCsrf, async (req, res) => {
  const collection = await ResearchCollection.findOne({ _id: req.params.id, userId: req.user._id });
  if (!collection) return res.status(404).json({ error: "Collection not found" });
  collection.items = collection.items.filter((item: any) => String(item._id) !== req.params.itemId) as any;
  await collection.save();
  res.json({ collection });
});

youtubeRouter.get("/oauth/start", (req, res, next) => {
  try {
    const state = randomToken(16);
    const publishing = req.query.publishing === "true";
    const commenting = req.query.commenting === "true";
    const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/).optional().parse(req.query.videoId);
    oauthStates.set(state, { userId: String(req.user._id), expiresAt: Date.now() + 10 * 60 * 1000, publishing, commenting, videoId });
    res.json({ url: googleAuthUrl(state, publishing, commenting) });
  } catch (error) {
    next(error);
  }
});

youtubeRouter.get("/oauth/callback", async (req, res, next) => {
  try {
    const state = String(req.query.state ?? "");
    const code = String(req.query.code ?? "");
    const saved = oauthStates.get(state);
    if (!saved || saved.expiresAt < Date.now()) return res.redirect(`${env.APP_URL}/dashboard/youtube-research?oauth=expired`);
    oauthStates.delete(state);
    await saveConnection(saved.userId, await exchangeCode(code), saved.publishing, saved.commenting);
    res.redirect(`${env.APP_URL}/dashboard/${saved.commenting && saved.videoId ? `youtube-research/watch/${saved.videoId}` : saved.publishing ? "youtube-channel" : "youtube-research"}?oauth=connected`);
  } catch (error) {
    next(error);
  }
});

youtubeRouter.post("/oauth/disconnect", requireCsrf, async (req, res) => {
  await YouTubeConnection.updateOne({ userId: req.user._id }, { disconnectedAt: new Date() });
  res.json({ message: "YouTube account disconnected" });
});

youtubeRouter.get("/analytics/summary", async (req, res, next) => {
  try {
    const connection = await YouTubeConnection.findOne({ userId: req.user._id, disconnectedAt: null });
    if (!connection) return res.status(404).json({ error: "Connect YouTube first" });
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    const params = new URLSearchParams({ ids: "channel==MINE", startDate: start, endDate: end, metrics: "views,estimatedMinutesWatched,averageViewDuration", dimensions: "day", sort: "day" });
    const data = await authorizedGet(connection, `https://youtubeanalytics.googleapis.com/v2/reports?${params.toString()}`);
    res.json({ data, note: "Private analytics are shown only for the connected authorized channel." });
  } catch (error) {
    next(error);
  }
});
