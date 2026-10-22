import { PublishingDraft } from "../models/PublishingDraft.js";
import { AIProject } from "../models/AIProject.js";
import { VideoExport } from "../models/VideoEdit.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { YouTubeConnection } from "../models/YouTubeConnection.js";
import { YouTubeUpload } from "../models/YouTubeUpload.js";
import { authorizedGet, normalizeVideo, refreshAccessToken, youtubeUploadScope } from "./youtube.js";
import { decryptSecret, encryptSecret } from "../utils/encryption.js";

const API = "https://www.googleapis.com/youtube/v3";
export const uploadInput = z.object({ confirmed: z.literal(true), tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]).refine(v => v.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0) + 1, 0) <= 500, "Tags must fit within YouTube?s 500 character limit"), publishAt: z.string().datetime().optional(), draftId: z.string().regex(/^[a-f\d]{24}$/i).optional(), projectId: z.string().regex(/^[a-f\d]{24}$/i).optional(), exportId: z.string().regex(/^[a-f\d]{24}$/i).optional(), title: z.string().trim().min(1).max(100).regex(/^[^<>]+$/, "Remove angle brackets from the title"), description: z.string().max(5000).default(""), privacy: z.enum(["private", "unlisted", "public"]).default("private"), madeForKids: z.boolean(), syntheticMedia: z.boolean(), fileName: z.string().min(1).max(200), fileSize: z.number().int().min(1).max(2 * 1024 * 1024 * 1024), contentType: z.enum(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]) });
export const publishError = (message: string, statusCode = 400): never => { throw Object.assign(new Error(message), { statusCode }); };
export function canUpload(connection: any) { return (connection?.scopes || []).some((s: string) => [youtubeUploadScope, "https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.force-ssl"].includes(s)); }
export async function ownConnection(userId: string, upload = false) {
  const connection = await YouTubeConnection.findOne({ userId, disconnectedAt: null });
  if (!connection?.channelId) publishError("Connect your YouTube channel to continue.", 409);
  if (upload && !canUpload(connection)) publishError("Enable uploads by reconnecting your YouTube channel with upload permission.", 403);
  return connection!;
}
async function token(connection: any) { return !connection.expiresAt || connection.expiresAt < new Date(Date.now() + 60000) ? refreshAccessToken(connection) : decryptSecret(connection.accessTokenEncrypted); }
async function googleError(response: globalThis.Response) { const body = await response.json().catch(() => ({})) as any; publishError(body.error?.message || "YouTube could not complete this request. Please try again.", response.status >= 500 ? 502 : response.status); }
export async function myChannel(userId: string, pageToken?: string) {
  const connection = await ownConnection(userId);
  const data = await authorizedGet(connection, `${API}/channels?part=snippet,statistics,contentDetails,brandingSettings&mine=true`);
  const item = data.items?.find((c: any) => c.id === connection.channelId);
  if (!item) publishError("Your connected channel could not be found. Reconnect YouTube.", 409);
  const playlist = item.contentDetails?.relatedPlaylists?.uploads;
  const entries = playlist ? await authorizedGet(connection, `${API}/playlistItems?${new URLSearchParams({ part: "contentDetails", playlistId: playlist, maxResults: "24", ...(pageToken ? { pageToken } : {}) })}`) : { items: [] };
  const ids = (entries.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean).join(",");
  const videos = ids ? await authorizedGet(connection, `${API}/videos?${new URLSearchParams({ part: "snippet,contentDetails,statistics,status", id: ids })}`) : { items: [] };
  return { channel: { id: item.id, title: item.snippet?.title, description: item.snippet?.description, handle: item.snippet?.customUrl, thumbnail: item.snippet?.thumbnails?.high?.url || connection.channelThumbnail, banner: item.brandingSettings?.image?.bannerExternalUrl, statistics: item.statistics || {}, country: item.snippet?.country, url: `https://www.youtube.com/channel/${item.id}` }, videos: (videos.items || []).map((v: any) => ({ ...normalizeVideo(v), privacy: v.status?.privacyStatus, uploadStatus: v.status?.uploadStatus })), canUpload: canUpload(connection), nextPageToken: entries.nextPageToken || null };
}
export function publicUpload(job: any) { return { _id: String(job._id), channelId: job.channelId, fileName: job.fileName, fileSize: job.fileSize, contentType: job.contentType, title: job.title, privacy: job.privacy, uploadedBytes: job.uploadedBytes, status: job.status, videoId: job.videoId, videoUrl: job.videoUrl, error: job.error, createdAt: job.createdAt, completedAt: job.completedAt, projectId: job.projectId, exportId: job.exportId, draftId: job.draftId, tags: job.tags, publishAt: job.publishAt, channelTitle: job.channelTitle }; }
function uploadUrl(job: any) {
  const url = new URL(decryptSecret(job.uploadUrlEncrypted));
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" || url.pathname !== "/upload/youtube/v3/videos" || !url.searchParams.get("upload_id")) publishError("Invalid YouTube upload session. Start a new upload.");
  return url.toString();
}
export async function createUpload(userId: string, body: unknown) {
  const input = uploadInput.parse(body), connection = await ownConnection(userId, true);
  if (input.publishAt && (input.privacy !== "private" || Date.parse(input.publishAt) < Date.now() + 5 * 60000)) publishError("Scheduled videos must be private with a publishing time at least five minutes in the future.");
  if (input.draftId && !await PublishingDraft.exists({ _id: input.draftId, userId })) publishError("Publishing draft not found.", 404);
  if (input.projectId && !await AIProject.exists({ _id: input.projectId, userId })) publishError("Project not found.", 404);
  if (input.exportId) { const exp = await VideoExport.findOne({ _id: input.exportId, userId, status: "completed",purpose:{$ne:"preview"} }); if (!exp || input.projectId && String(exp.projectId) !== input.projectId) publishError("Finished video does not match this project."); input.projectId = String(exp!.projectId); }
  try {
  const response = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: { Authorization: `Bearer ${await token(connection)}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(input.fileSize), "X-Upload-Content-Type": input.contentType }, body: JSON.stringify({ snippet: { title: input.title, description: input.description, tags: input.tags, categoryId: "22" }, status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: input.madeForKids, containsSyntheticMedia: input.syntheticMedia, ...(input.publishAt ? { publishAt: input.publishAt } : {}) } }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) await googleError(response);
  const location = response.headers.get("location"); if (!location) publishError("YouTube did not start the upload. Please try again.", 502);
  const values = { ...input, userId, channelId: connection.channelId, channelTitle: connection.channelTitle, uploadUrlEncrypted: encryptSecret(location!) }; uploadUrl(values);
  return await YouTubeUpload.create(values);
  } catch (error: any) {
    await YouTubeUpload.create({ ...input, userId, channelId: connection.channelId, channelTitle: connection.channelTitle, status: "failed", error: "YouTube could not start this upload. Check your connection and publishing permissions before retrying." }).catch(() => null);
    throw error;
  }
}
async function applyResponse(job: any, response: globalThis.Response) {
  if (response.status === 308) {
    const range = response.headers.get("range"), last = range?.match(/^bytes=0-(\d+)$/)?.[1];
    const uploaded = last ? Number(last) + 1 : 0;
    if (uploaded > job.fileSize) publishError("YouTube returned an invalid upload position.", 502);
    job.uploadedBytes = uploaded; job.error = "";
  } else if (response.status === 404 || response.status === 410) { job.status = "expired"; job.error = "This upload session expired. Start a new upload.";
  } else if (response.ok) {
    const data = await response.json() as any;
    if (!data.id || (data.snippet?.channelId && data.snippet.channelId !== job.channelId)) publishError("YouTube did not confirm this video belongs to your channel.", 502);
    job.status = "completed"; job.uploadedBytes = job.fileSize; job.videoId = data.id; job.videoUrl = `https://www.youtube.com/watch?v=${data.id}`; job.completedAt = new Date(); job.error = "";
    if (data.status?.privacyStatus) job.privacy = data.status.privacyStatus;
  } else await googleError(response);
}
async function withUpload(userId: string, id: string, action: (job: any, connection: any) => Promise<void>) {
  if (!/^[a-f\d]{24}$/i.test(id)) publishError("Upload not found.", 404);
  const connection = await ownConnection(userId, true), leaseToken = randomUUID();
  const job: any = await YouTubeUpload.findOneAndUpdate({ _id: id, userId, channelId: connection.channelId, status: "uploading", $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }] }, { $set: { leaseToken, leaseUntil: new Date(Date.now() + 180000) } }, { new: true });
  if (!job) { const existing = await YouTubeUpload.findOne({ _id: id, userId, channelId: connection.channelId }); if (!existing) publishError("Upload not found.", 404); if (existing!.status !== "uploading") return existing!; publishError("An upload request is already running. Please wait.", 409); }
  try {
    await action(job, connection);
    return await YouTubeUpload.findOneAndUpdate({ _id: id, leaseToken }, { $set: { status: job.status, uploadedBytes: job.uploadedBytes, videoId: job.videoId, videoUrl: job.videoUrl, completedAt: job.completedAt, privacy: job.privacy, error: job.error }, $unset: { leaseToken: 1, leaseUntil: 1 } }, { new: true });
  } catch (error) { await YouTubeUpload.updateOne({ _id: id, leaseToken }, { $set: { error: "Upload interrupted. Resume to check the saved upload position." }, $unset: { leaseToken: 1, leaseUntil: 1 } }); throw error; }
}
export async function refreshUpload(userId: string, id: string) {
  return withUpload(userId, id, async (job, connection) => {
    const response = await fetch(uploadUrl(job), { method: "PUT", headers: { Authorization: `Bearer ${await token(connection)}`, "Content-Length": "0", "Content-Range": `bytes */${job.fileSize}` }, body: Buffer.alloc(0), redirect: "manual", signal: AbortSignal.timeout(30000) }); await applyResponse(job, response);
  });
}
export async function uploadChunk(userId: string, id: string, offset: number, bytes: Buffer) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024) publishError("Choose a valid video chunk up to 8 MB.");
  return withUpload(userId, id, async (job, connection) => {
    if (job.uploadedBytes !== offset) publishError("The upload position changed. Resume the upload to continue.", 409);
    if (offset + bytes.length > job.fileSize || (offset + bytes.length < job.fileSize && bytes.length % (256 * 1024) !== 0)) publishError("Invalid video chunk size.");
    const response = await fetch(uploadUrl(job), { method: "PUT", headers: { Authorization: `Bearer ${await token(connection)}`, "Content-Type": job.contentType, "Content-Length": String(bytes.length), "Content-Range": `bytes ${offset}-${offset + bytes.length - 1}/${job.fileSize}` }, body: new Uint8Array(bytes), redirect: "manual", signal: AbortSignal.timeout(120000) }); await applyResponse(job, response);
  });
}
export async function setThumbnail(userId: string, videoId: string, bytes: Buffer) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(videoId)) publishError("Invalid video.");
  const connection = await ownConnection(userId, true);
  const own = await authorizedGet(connection, `${API}/videos?part=snippet&id=${encodeURIComponent(videoId)}`);
  if (!own.items?.some((v: any) => v.id === videoId && v.snippet?.channelId === connection.channelId)) publishError("This video does not belong to your connected channel.", 404);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024) publishError("Choose a JPG, PNG or WebP image under 10 MB.");
  let image: Buffer;
  try { const source = sharp(bytes, { limitInputPixels: 40000000 }); const info = await source.metadata(); if (!["jpeg", "png", "webp"].includes(info.format || "") || (info.pages || 1) > 1) throw new Error(); image = await source.rotate().resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); } catch { publishError("This picture could not be read. Choose a JPG, PNG or WebP image."); }
  const response = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: "POST", headers: { Authorization: `Bearer ${await token(connection)}`, "Content-Type": "image/jpeg" }, body: new Uint8Array(image!), signal: AbortSignal.timeout(30000) });
  if (!response.ok) await googleError(response); const result = await response.json() as any;
  return { thumbnail: result.items?.[0]?.high?.url || result.items?.[0]?.medium?.url || result.items?.[0]?.default?.url || "" };
}
