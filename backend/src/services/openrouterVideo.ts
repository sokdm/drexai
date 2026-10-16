import { env } from "../config/env.js";
import { routerResponse, verifiedRouterModel, routerId, recordRouterUsage } from "./openrouter.js";
import { buildVeoPrompt } from "./sceneAudio.js";
import { inspectNativeVideo } from "./nativeAudio.js";

export async function createRouterVideo(settings: any) {
  const record = await verifiedRouterModel(settings.model, "video");
  for (const [key, value] of [["supported_durations", settings.durationSeconds], ["supported_resolutions", String(settings.quality).toLowerCase()], ["supported_aspect_ratios", settings.aspectRatio]] as const) {
    if (!record[key]?.includes(value)) throw new Error(`OpenRouter video capability not verified: ${key}=${value}`);
  }
  // Only the documented native-audio Veo adapter is exposed; generic video is not a talking-avatar API.
  if (!["google/veo-3.1", "alibaba/wan-3.0"].includes(routerId(settings.model))) throw new Error("A native-audio-capable video adapter is required");
  if (routerId(settings.model) === "alibaba/wan-3.0" && (record.generate_audio !== true || !record.supported_frame_images?.includes("first_frame"))) throw new Error("Native audio and first-frame input are not verified for this model");
  const body: any = { model: routerId(settings.model), prompt: buildVeoPrompt(settings), duration: settings.durationSeconds, resolution: String(settings.quality).toLowerCase(), aspect_ratio: settings.aspectRatio, generate_audio: true };
  if (settings.sourceImageBytes) body.frame_images = [{ type: "image_url", frame_type: "first_frame", image_url: { url: `data:${settings.sourceImageMimeType || "image/png"};base64,${settings.sourceImageBytes}` } }];
  const response = await routerResponse("videos", body, 60000), data = await response.json();
  if (!/^[\w-]+$/.test(data.id || "")) throw new Error("OpenRouter did not return a valid video job ID; do not resubmit automatically");
  return `openrouter:${data.id}`;
}
export async function pollRouterVideo(operationName: string, timeout = 12 * 60000) {
  const id = operationName.slice("openrouter:".length); if (!/^[\w-]+$/.test(id)) throw new Error("Invalid OpenRouter video operation");
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const response = await routerResponse(`videos/${id}`), data = await response.json();
    if (["failed", "cancelled", "expired"].includes(data.status)) throw Object.assign(new Error(`OpenRouter video ${data.status}: ${String(data.error?.message || data.error || "Provider could not complete this clip").slice(0, 500)}`), { providerRejected: true });
    if (data.status === "completed") return { name: operationName, done: true, response: { openrouter: data } };
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error("OpenRouter video polling timed out. Resume the saved operation; do not submit a duplicate generation.");
}
export async function downloadRouterVideo(operation: any, userId?: string, model?: string) {
  const id = String(operation.name).slice("openrouter:".length);
  const response = await downloadRouterContent(id);
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await inspectNativeVideo(buffer);
  await recordRouterUsage(model || (operation.response.openrouter.model ? "openrouter/" + operation.response.openrouter.model : "openrouter/google/veo-3.1"), "video", operation.response.openrouter, userId);
  return [{ buffer, contentType: "video/mp4", metadata: { ...metadata, gateway: "openrouter", usage: operation.response.openrouter.usage } }];
}

export async function downloadRouterContent(id: string, request: typeof fetch = fetch) {
 if (!/^[\w-]+$/.test(id)) throw new Error("Invalid video download ID");
 let url = new URL(`https://openrouter.ai/api/v1/videos/${id}/content?index=0`);
 for (let index = 0; index <= 5; index++) {
  const origin = url.origin === "https://openrouter.ai";
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || !origin && !(url.hostname === "storage.googleapis.com" || [".openrouter.ai", ".r2.cloudflarestorage.com", ".cloudfront.net", ".googleusercontent.com", ".fal.media", ".blob.core.windows.net"].some(suffix => url.hostname.endsWith(suffix)))) throw new Error("Unexpected OpenRouter download host");
  const response = await request(url, { headers: origin ? { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } : {}, redirect: "manual", signal: AbortSignal.timeout(120000) });
  if (![301,302,303,307,308].includes(response.status)) { if (!response.ok) throw new Error("OpenRouter content download failed"); return response; }
  const target = response.headers.get("location"); await response.body?.cancel(); if (!target) throw new Error("Missing OpenRouter redirect destination"); url = new URL(target, url);
 }
 throw new Error("Too many OpenRouter download redirects");
}
