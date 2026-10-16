import { PutObjectCommand, S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

function r2Client() {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) return null;
  return new S3Client({
    region: "auto",
    requestChecksumCalculation: "WHEN_REQUIRED",
    endpoint: process.env.NODE_ENV === "test" && process.env.R2_TEST_ENDPOINT ? process.env.R2_TEST_ENDPOINT : `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: process.env.NODE_ENV === "test" && Boolean(process.env.R2_TEST_ENDPOINT),
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
  });
}

export async function uploadImage(buffer: Buffer, key: string, contentType = "image/png") {
  return uploadMedia(buffer, key, contentType);
}

export async function uploadVideo(buffer: Buffer, key: string, contentType = "video/mp4") {
  return uploadMedia(buffer, key, contentType);
}

export async function uploadAudio(buffer: Buffer, key: string, contentType = "audio/wav") {
  return uploadMedia(buffer, key, contentType);
}

async function uploadMedia(buffer: Buffer, key: string, contentType: string) {
  const client = r2Client();
  if (!client || !env.R2_BUCKET) {
    return { key, bucket: "local-dev", url: `data:${contentType};base64,${buffer.toString("base64")}`, storageProvider: "inline-dev" };
  }
  await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  const url = env.R2_PUBLIC_BASE_URL ? `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}` : await getSignedUrl(client, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn: 3600 });
  return { key, bucket: env.R2_BUCKET, url, storageProvider: "r2" };
}

export async function signedImageUrl(key: string) {
  const client = r2Client();
  if (!client || !env.R2_BUCKET) return "";
  return getSignedUrl(client, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn: 3600 });
}

export function persistentStorageConfigured() {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);
}

export async function readMediaObject(key: string) {
  const client = r2Client();
  if (!client || !env.R2_BUCKET) throw new Error("Persistent R2 storage is not configured");
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    if (!object.Body) return null;
    return { buffer: Buffer.from(await object.Body.transformToByteArray()), contentType: object.ContentType ?? "application/octet-stream", bucket: env.R2_BUCKET };
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function deleteImageObject(key: string) {
  const client = r2Client();
  if (!client || !env.R2_BUCKET) return;
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}

// Final renders never use the inline-development fallback.
export async function uploadVerifiedExport(file: string, key: string) {
  const client = r2Client();
  if (!client || !env.R2_BUCKET) throw new Error("Configure private R2 storage before exporting");
  const size = (await stat(file)).size;
  await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: "video/mp4" }));
  const head = await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  if (head.ContentLength !== size) throw new Error("Stored export size does not match rendered output");
  const url = await signedImageUrl(key);
  const response = await fetch(url, { headers: { Range: "bytes=0-1023" }, signal: AbortSignal.timeout(20000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok || bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("R2 export could not be accessed as an MP4");
  return { key, bucket: env.R2_BUCKET, sizeBytes: size };
}
export async function openMediaStream(key: string) {
  const client = r2Client();
  if (!client || !env.R2_BUCKET) throw new Error("R2 storage unavailable");
  return client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}

export async function creativeUploadUrl(key: string, size: number) {
  const client = r2Client(); if (!client || !env.R2_BUCKET) throw new Error("Private R2 storage is required");
  return getSignedUrl(client, new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: "video/mp4", ContentLength: size }), { expiresIn: 900 });
}
export async function mediaObjectSize(key: string) { const client = r2Client(); if (!client) throw new Error("R2 unavailable"); return (await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))).ContentLength; }
