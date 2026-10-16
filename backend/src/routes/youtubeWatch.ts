import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { cachedGet, normalizeVideo, refreshAccessToken, youtubeCommentScope } from "../services/youtube.js";
import { YouTubeConnection } from "../models/YouTubeConnection.js";
import { YouTubeCache } from "../models/YouTubeCache.js";
import { decryptSecret } from "../utils/encryption.js";
import { requireAuth, requireCsrf } from "../middleware/auth.js";

export const youtubeWatchRouter = Router();
youtubeWatchRouter.use(["/watch", "/comment-replies"], requireAuth, rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false }));
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/, "Invalid video ID");
const commentId = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const page = z.string().max(500).optional();
const comment = (v: any) => ({ id: v.id, author: v.snippet?.authorDisplayName, avatar: v.snippet?.authorProfileImageUrl, text: v.snippet?.textOriginal ?? v.snippet?.textDisplay, likes: v.snippet?.likeCount, date: v.snippet?.publishedAt });
async function source(id: string) {
  const data = await cachedGet("videos", { id, part: "snippet,contentDetails,statistics,status,topicDetails" }, 1);
  const v = data.items?.[0]; if (!v) throw Object.assign(new Error("This video is unavailable or private."), { status: 404 }); return v;
}
function failure(res: any, err: any, readComments = false) {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid video or comment request." });
  const reason = err.reason;
  if (readComments && reason === "commentsDisabled") return res.json({ items: [], disabled: true });
  const quota = ["quotaExceeded", "dailyLimitExceeded"].includes(reason);
  return res.status(quota ? 429 : err.status || 502).json({ error: quota ? "YouTube's request limit has been reached. Please try again later." : err.message || "YouTube could not load. Please try again.", reason });
}
youtubeWatchRouter.get("/watch/:videoId", async (req, res) => {
  try { const v = await source(videoId.parse(req.params.videoId)); res.json({ video: { ...normalizeVideo(v), embeddable: v.status?.embeddable !== false } }); } catch (e) { failure(res, e); }
});
youtubeWatchRouter.get("/watch/:videoId/recommendations", async (req, res) => {
  try {
    const id = videoId.parse(req.params.videoId), v = await source(id), token = page.parse(req.query.pageToken);
    const keywords = [...(v.snippet?.tags || []).slice(0, 3), ...(v.topicDetails?.topicCategories || []).slice(0, 1).map((s: string) => s.split("/").pop()?.replace(/_/g, " "))].join(" ");
    const q = `${v.snippet.title} ${keywords}`.slice(0, 220);
    const data = await cachedGet("search", { part: "snippet", type: "video", q, videoEmbeddable: "true", maxResults: "12", pageToken: token }, 100);
    const same = !token ? await cachedGet("search", { part: "snippet", type: "video", channelId: v.snippet.channelId, videoEmbeddable: "true", maxResults: "3" }, 100) : { items: [] };
    const ids = [...new Set<string>([...(data.items || []), ...(same.items || [])].map((x: any) => x.id.videoId).filter((x: string) => x && x !== id))];
    const details = ids.length ? await cachedGet("videos", { part: "snippet,contentDetails,statistics,status", id: ids.join(",") }, 1) : { items: [] };
    res.json({ items: (details.items || []).filter((x: any) => x.status?.embeddable !== false).map(normalizeVideo), nextPageToken: data.nextPageToken });
  } catch (e) { failure(res, e); }
});
youtubeWatchRouter.get("/watch/:videoId/comments", async (req, res) => {
  try {
    const data = await cachedGet("commentThreads", { part: "snippet", videoId: videoId.parse(req.params.videoId), order: z.enum(["relevance", "time"]).default("relevance").parse(req.query.order), textFormat: "plainText", maxResults: "20", pageToken: page.parse(req.query.pageToken) }, 1);
    res.json({ items: (data.items || []).map((v: any) => ({ ...comment(v.snippet.topLevelComment), replyCount: v.snippet.totalReplyCount, canReply: v.snippet.canReply })), nextPageToken: data.nextPageToken });
  } catch (e) { failure(res, e, true); }
});
youtubeWatchRouter.get("/comment-replies/:id", async (req, res) => {
  try { const data = await cachedGet("comments", { part: "snippet", parentId: commentId.parse(req.params.id), textFormat: "plainText", maxResults: "50", pageToken: page.parse(req.query.pageToken) }, 1); res.json({ items: (data.items || []).map(comment), nextPageToken: data.nextPageToken }); } catch (e) { failure(res, e); }
});
youtubeWatchRouter.post("/watch/:videoId/comments", requireCsrf, rateLimit({ windowMs: 60000, limit: 5 }), async (req, res) => {
  try {
    const id = videoId.parse(req.params.videoId), input = z.object({ text: z.string().trim().min(1).max(10000), parentId: commentId.optional() }).parse(req.body);
    const connection = await YouTubeConnection.findOne({ userId: req.user._id, disconnectedAt: null });
    if (!connection || !connection.scopes.some(s => [youtubeCommentScope, "https://www.googleapis.com/auth/youtube"].includes(s))) return res.status(403).json({ error: "Authorize YouTube commenting to post with your connected channel.", reason: "authorizationRequired" });
    if (input.parentId) {
      const parent = await cachedGet("comments", { part: "snippet", id: input.parentId, textFormat: "plainText" }, 1);
      if (parent.items?.[0]?.snippet?.videoId !== id || parent.items?.[0]?.snippet?.parentId) return res.status(400).json({ error: "This reply does not belong to this video." });
    }
    const token = !connection.expiresAt || connection.expiresAt < new Date(Date.now() + 60000) ? await refreshAccessToken(connection) : decryptSecret(connection.accessTokenEncrypted);
    const v = input.parentId ? null : await source(id);
    const body = input.parentId ? { snippet: { parentId: input.parentId, textOriginal: input.text } } : { snippet: { videoId: id, channelId: v.snippet.channelId, topLevelComment: { snippet: { textOriginal: input.text } } } };
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${input.parentId ? "comments" : "commentThreads"}?part=snippet`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error?.message || "Your comment could not be posted."), { status: response.status, reason: data.error?.errors?.[0]?.reason });
    // Public cached reads must not mask a newly posted comment or reply.
    await YouTubeCache.deleteMany({ $or: [{ "data.items.snippet.videoId": id }, { "data.items.snippet.parentId": input.parentId || "__none__" }] });
    res.status(201).json({ comment: comment(input.parentId ? data : data.snippet.topLevelComment), moderationNotice: "YouTube may hold comments for review." });
  } catch (e: any) { if (e instanceof z.ZodError) return res.status(400).json({ error: "Check your comment and video details." }); failure(res, e); }
});
