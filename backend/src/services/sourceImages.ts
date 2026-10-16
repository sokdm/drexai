import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "../config/env.js";
import { MediaAsset } from "../models/MediaAsset.js";
import { persistentStorageConfigured, readMediaObject, signedImageUrl, uploadImage, deleteImageObject } from "./mediaStorage.js";

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const invalid = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

export async function normalizeSourceImage(buffer: Buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_SOURCE_BYTES) throw invalid("Upload a PNG, JPEG, or WebP image up to 10 MB.");
  try {
    const image = sharp(buffer, { limitInputPixels: 40000000, failOn: "warning" });
    const meta = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw new Error("Unsupported image");
    return await image.rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  } catch { throw invalid("This image could not be read. Choose a non-animated PNG, JPEG, or WebP under 40 megapixels."); }
}

function localPath(key: string) {
  const root = path.resolve(env.UPLOAD_DIR);
  const file = path.resolve(root, key);
  if (!file.startsWith(root + path.sep)) throw invalid("Invalid media path");
  return file;
}

export async function sourceImageUrl(asset: any) {
  if (asset.storageProvider === "local-upload") return `/api/videos/source-images/${asset._id}/content`;
  return asset.url?.startsWith("data:") ? asset.url : await signedImageUrl(asset.key) || asset.url;
}

export async function saveSourceImage(userId: string, bytes: Buffer, name: string) {
  const { data, info } = await normalizeSourceImage(bytes);
  const key = `${userId}/sources/${randomUUID()}.png`;
  let stored;
  if (persistentStorageConfigured()) stored = await uploadImage(data, key, "image/png");
  else {
    if (process.env.NODE_ENV === "production") throw Object.assign(new Error("Configure private R2 storage before uploading images in production."), { statusCode: 503 });
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: "wx" });
    stored = { key, bucket: "local-development", storageProvider: "local-upload", url: "" };
  }
  try {
    const asset = await MediaAsset.create({ userId, type: "image", provider: "upload", ...stored, contentType: "image/png", sizeBytes: data.length, width: info.width, height: info.height, metadata: { name: name.slice(0, 150), originalUpload: true } });
    return { ...asset.toObject(), url: await sourceImageUrl(asset) };
  } catch (error) {
    if (stored.storageProvider === "local-upload") await unlink(localPath(key)).catch(() => null);
    else await deleteImageObject(key).catch(() => null);
    throw error;
  }
}

export async function readSourceImage(asset: any) {
  if (asset.storageProvider === "local-upload") return { buffer: await readFile(localPath(asset.key)), contentType: "image/png" };
  if (asset.url?.startsWith("data:")) {
    const match = asset.url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw invalid("Invalid source image");
    return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] };
  }
  const data = await readMediaObject(asset.key);
  if (!data) throw invalid("Source image is no longer available");
  return data;
}
