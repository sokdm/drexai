import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { YouTubeCache } from "../models/YouTubeCache.js";
import { YouTubeConnection } from "../models/YouTubeConnection.js";
import { decryptSecret, encryptSecret } from "../utils/encryption.js";

const API = "https://www.googleapis.com/youtube/v3";
const OAUTH = "https://oauth2.googleapis.com/token";
const scopes = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
export const youtubeCommentScope = "https://www.googleapis.com/auth/youtube.force-ssl";
export const youtubeUploadScope = "https://www.googleapis.com/auth/youtube.upload";

function cacheKey(path: string, params: URLSearchParams) {
  return createHash("sha256").update(`${path}?${params.toString()}`).digest("hex");
}

const pendingPublicRequests = new Map<string, Promise<any>>();
export function cachedGet(path: string, params: Record<string, string | undefined>, quotaUnits: number): Promise<any> {
  const key = JSON.stringify([path, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))]);
  const pending = pendingPublicRequests.get(key); if (pending) return pending;
  const request = publicGet(path, params, quotaUnits).finally(() => pendingPublicRequests.delete(key));
  pendingPublicRequests.set(key, request); return request;
}
async function publicGet(path: string, params: Record<string, string | undefined>, quotaUnits: number) {
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not configured");
  const search = new URLSearchParams({ part: params.part ?? "snippet", key: env.YOUTUBE_API_KEY });
  Object.entries(params).forEach(([key, value]) => value && search.set(key, value));
  const key = cacheKey(path, search);
  const cached = await YouTubeCache.findOne({ key, expiresAt: { $gt: new Date() } });
  if (cached) return { ...cached.data, cached: true };
  const response = await fetch(`${API}/${path}?${search.toString()}`, { signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message ?? "YouTube request failed"), { status: response.status, reason: data.error?.errors?.[0]?.reason });
  await YouTubeCache.updateOne({ key }, { $set: { data, quotaUnits, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } }, { upsert: true });
  return { ...data, cached: false };
}

export async function searchVideos(input: any) {
  const data = await cachedGet("search", {
    part: "snippet",
    type: "video",
    q: input.q,
    regionCode: input.regionCode,
    relevanceLanguage: input.relevanceLanguage,
    videoDuration: input.videoDuration,
    videoCategoryId: input.videoCategoryId,
    order: input.order ?? "relevance",
    publishedAfter: input.publishedAfter,
    publishedBefore: input.publishedBefore,
    pageToken: input.pageToken,
    maxResults: String(input.maxResults ?? 12),
    safeSearch: "moderate"
  }, 1);
  const ids = data.items?.map((item: any) => item.id.videoId).filter(Boolean).join(",");
  if (!ids) return { items: [], nextPageToken: data.nextPageToken, cached: data.cached };
  const details = await cachedGet("videos", { part: "snippet,contentDetails,statistics", id: ids, maxResults: "50" }, 1);
  let items = details.items ?? [];
  if (input.minViews) items = items.filter((item: any) => Number(item.statistics?.viewCount ?? 0) >= Number(input.minViews));
  if (input.minLikes) items = items.filter((item: any) => Number(item.statistics?.likeCount ?? 0) >= Number(input.minLikes));
  if (input.minComments) items = items.filter((item: any) => Number(item.statistics?.commentCount ?? 0) >= Number(input.minComments));
  return { items: items.map(normalizeVideo), nextPageToken: data.nextPageToken, cached: data.cached, limitation: "View, like, and comment thresholds are applied after retrieving YouTube results." };
}

export async function popularVideos(input: any) {
  const data = await cachedGet("videos", {
    part: "snippet,contentDetails,statistics",
    chart: "mostPopular",
    regionCode: input.regionCode ?? "US",
    videoCategoryId: input.videoCategoryId,
    pageToken: input.pageToken,
    maxResults: String(input.maxResults ?? 12)
  }, 1);
  return { items: (data.items ?? []).map(normalizeVideo), nextPageToken: data.nextPageToken, cached: data.cached };
}

export async function resolveChannel(value: string) {
  if (!value) throw new Error("Enter a channel link, handle, or ID");
  const clean = value.trim();
  let channelId = clean.match(/channel\/([^/?]+)/)?.[1] ?? (clean.startsWith("UC") ? clean : "");
  if (!channelId) {
    const handle = clean.match(/@([A-Za-z0-9._-]+)/)?.[1] ?? clean.replace(/^@/, "");
    const search = await cachedGet("search", { part: "snippet", type: "channel", q: handle, maxResults: "1" }, 1);
    channelId = search.items?.[0]?.id?.channelId;
  }
  if (!channelId) throw new Error("Channel not found");
  const channel = await cachedGet("channels", { part: "snippet,statistics,contentDetails,topicDetails", id: channelId }, 1);
  const item = channel.items?.[0];
  if (!item) throw new Error("Channel not found");
  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  const uploadItems = uploads ? await cachedGet("playlistItems", { part: "snippet,contentDetails", playlistId: uploads, maxResults: "12" }, 1) : { items: [] };
  const videoIds = uploadItems.items?.map((i: any) => i.contentDetails?.videoId).filter(Boolean).join(",");
  const videos = videoIds ? await cachedGet("videos", { part: "snippet,contentDetails,statistics", id: videoIds }, 1) : { items: [] };
  return { channel: normalizeChannel(item), uploads: (videos.items ?? []).map(normalizeVideo), publishingFrequency: estimateFrequency(videos.items ?? []) };
}

export function googleAuthUrl(state: string, publishing = false, commenting = false) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID is not configured");
  const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: [...scopes, ...(publishing ? [youtubeUploadScope] : []), ...(commenting ? [youtubeCommentScope] : [])].join(" "), state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth is not configured");
  const response = await fetch(OAUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI, grant_type: "authorization_code" }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description ?? "Google OAuth exchange failed");
  return data;
}

export async function refreshAccessToken(connection: any) {
  if (!connection.refreshTokenEncrypted || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("Reconnect your Google account");
  const response = await fetch(OAUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: decryptSecret(connection.refreshTokenEncrypted), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: "refresh_token" }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description ?? "Google token refresh failed");
  connection.accessTokenEncrypted = encryptSecret(data.access_token);
  connection.expiresAt = new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000);
  await connection.save();
  return data.access_token;
}

export async function authorizedGet(connection: any, url: string) {
  const token = !connection.expiresAt || connection.expiresAt < new Date(Date.now() + 60_000) ? await refreshAccessToken(connection) : decryptSecret(connection.accessTokenEncrypted);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "Authorized YouTube request failed");
  return data;
}

export async function saveConnection(userId: string, tokenData: any, publishing = false, commenting = false) {
  const accessToken = tokenData.access_token;
  const channelResponse = await fetch(`${API}/channels?part=snippet,statistics&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const channelData = await channelResponse.json();
  if (!channelResponse.ok) throw new Error(channelData.error?.message || "Your YouTube channel could not be connected. Please try again.");
  const channel = channelData.items?.[0];
  if (!channel?.id) throw new Error("This Google account has no YouTube channel. Create a channel on YouTube, then reconnect.");
  return YouTubeConnection.findOneAndUpdate({ userId }, {
    userId,
    channelId: channel?.id,
    channelTitle: channel?.snippet?.title,
    channelThumbnail: channel?.snippet?.thumbnails?.default?.url,
    scopes: tokenData.scope ? String(tokenData.scope).split(/\s+/) : [...scopes, ...(publishing ? [youtubeUploadScope] : []), ...(commenting ? [youtubeCommentScope] : [])],
    accessTokenEncrypted: encryptSecret(accessToken),
    refreshTokenEncrypted: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : undefined,
    expiresAt: new Date(Date.now() + Number(tokenData.expires_in ?? 3600) * 1000),
    disconnectedAt: null
  }, { upsert: true, new: true });
}

export function normalizeVideo(item: any) {
  return { id: item.id, title: item.snippet?.title, channelId: item.snippet?.channelId, channelTitle: item.snippet?.channelTitle, description: item.snippet?.description, publishedAt: item.snippet?.publishedAt, thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url, duration: item.contentDetails?.duration, statistics: item.statistics ?? {}, url: `https://www.youtube.com/watch?v=${item.id}` };
}

function normalizeChannel(item: any) {
  return { id: item.id, title: item.snippet?.title, description: item.snippet?.description, thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url, statistics: item.statistics ?? {}, topics: item.topicDetails?.topicCategories ?? [], url: `https://www.youtube.com/channel/${item.id}` };
}

function estimateFrequency(items: any[]) {
  const dates = items.map((i) => new Date(i.snippet?.publishedAt).getTime()).filter(Boolean).sort((a, b) => b - a);
  if (dates.length < 2) return "Not enough upload history to estimate.";
  const days = (dates[0] - dates[dates.length - 1]) / 86400000 || 1;
  return `${(dates.length / days * 7).toFixed(1)} uploads/week based on recent public uploads`;
}
