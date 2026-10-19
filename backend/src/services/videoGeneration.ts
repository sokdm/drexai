import { isOpenRouter } from "./openrouter.js";
import { createRouterVideo, pollRouterVideo, downloadRouterVideo } from "./openrouterVideo.js";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { buildVeoPrompt, sceneAudioFields, segmentDialogue } from "./sceneAudio.js";
import { z } from "zod";
import { inspectNativeVideo } from "./nativeAudio.js";
import { withProvider } from "./platformControl.js";
import { env } from "../config/env.js";

const directVideoModels = [
  { id: "veo-3.1-generate-preview", label: "Veo 3.1", aspectRatios: ["16:9", "9:16"], durations: [8, 6, 4], qualities: ["720p", "1080p", "4K"], maxQuantity: 1, imageToVideo: true, nativeAudio: true }
];

const alternativeVideoModels = [{ id: "openrouter/alibaba/wan-3.0", label: "Wan 3.0 with audio", aspectRatios: ["16:9", "9:16"], durations: [8, 6, 4], qualities: ["720p", "1080p"], maxQuantity: 1, imageToVideo: true, nativeAudio: true }];
const routerVideoModels = directVideoModels.map(m => ({ ...m, id: "openrouter/google/veo-3.1", label: "Veo 3.1 via OpenRouter", qualities: ["720p", "1080p"] }));
export const videoModels = env.OPENROUTER_API_KEY ? [...alternativeVideoModels, ...routerVideoModels, ...directVideoModels] : [...directVideoModels, ...alternativeVideoModels, ...routerVideoModels];

export function validateVideoSettings(input: any) {
  const model = videoModels.find((item) => item.id === input.model);
  if (!model) throw new Error("Unsupported Veo model");
  if (!model.aspectRatios.includes(input.aspectRatio)) throw new Error("Unsupported aspect ratio for selected Veo model");
  if (!model.durations.includes(Number(input.durationSeconds))) throw new Error("Unsupported duration for selected Veo model");
  if (!model.qualities.includes(input.quality)) throw new Error("Unsupported output quality for selected Veo model");
  if (!model.id.includes("alibaba/wan-") && input.quality !== "720p" && Number(input.durationSeconds) !== 8) throw new Error("1080p and 4K Veo output require an eight-second clip");
  const quantity = Number(input.quantity ?? 1);
  if (quantity < 1 || quantity > model.maxQuantity) throw new Error(`Selected model supports 1-${model.maxQuantity} outputs`);
  if (!String(input.motionPrompt ?? "").trim()) throw new Error("Motion prompt is required");
  if (!input.sourceImageAssetId && !input.sourceImageUrl) throw new Error("Select or upload a source image first");
  const audio = z.object(sceneAudioFields).parse(input);
  if (segmentDialogue(audio.dialogueLines ?? [], Number(input.durationSeconds)).length > 1) throw new Error("Dialogue is too long for this clip. Use at most 14 words per 8 seconds, or divide it into Studio scenes.");
  return { ...input, ...audio, model: model.id, quantity, durationSeconds: Number(input.durationSeconds), nativeAudio: true };
}

export function planClipDurations(targetSeconds: number, modelId = env.VEO_MODEL) {
  const model = videoModels.find((item) => item.id === modelId) ?? videoModels[0];
  const clipLength = model.durations[0];
  const clips = Math.max(1, Math.ceil(targetSeconds / clipLength));
  return Array.from({ length: clips }, (_, index) => ({ order: index + 1, durationSeconds: clipLength, note: index === clips - 1 && targetSeconds % clipLength ? "Trim in editor later" : "Full supported clip" }));
}

export function videoCreditCost(settings: any) {
  const qualityMultiplier = settings.quality === "4K" ? 4 : settings.quality === "1080p" ? 2 : 1;
  return Number(settings.quantity) * Math.ceil(Number(settings.durationSeconds) / 8) * qualityMultiplier * 6;
}

export async function createVeoOperation(settings: any) { return withProvider(settings.model, () => isOpenRouter(settings.model) ? createRouterVideo(settings) : createVeoOperationUnchecked(settings)); }
async function createVeoOperationUnchecked(settings: any) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  try {
    const operation = await veoClient().models.generateVideos(veoRequest(settings));
    if (!operation.name) throw new Error("Veo did not return an operation ID");
    return operation.name;
  } catch (error: any) { if (error.status && error.status < 500) error.providerRejected = true; throw error; }
}
export function veoRequest(settings: any) {
  return {
    model: settings.model, prompt: buildVeoPrompt(settings),
    ...(settings.sourceImageBytes ? { image: { imageBytes: settings.sourceImageBytes, mimeType: settings.sourceImageMimeType ?? "image/png" } } : {}),
    config: { aspectRatio: settings.aspectRatio, numberOfVideos: settings.quantity, durationSeconds: settings.durationSeconds, resolution: String(settings.quality).toLowerCase() }
  };
}
function veoClient() {
  // Native audio is inherent to this Veo model. No unsupported generateAudio or voice-ID parameter.
  throw new Error("Direct Google video API access is disabled. Use the approved OpenRouter video route.");
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY!, httpOptions: { timeout: 60000, retryOptions: { attempts: 1 } } });
}
export async function pollVeoOperation(operationName: string, timeoutMs = 12 * 60 * 1000) {
  if (operationName.startsWith("openrouter:")) return pollRouterVideo(operationName, timeoutMs) as Promise<any>;
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  if (!/^(?:models\/[\w.-]+\/)?operations\/[\w.-]+$/.test(operationName)) throw new Error("Invalid provider operation name");
  const started = Date.now(), client = veoClient();
  let operation = new GenerateVideosOperation(); operation.name = operationName;
  while (Date.now() - started < timeoutMs) {
    operation = await client.operations.getVideosOperation({ operation });
    if (operation.done && operation.error) throw Object.assign(new Error(String(operation.error.message ?? "Veo generation failed")), { providerRejected: true });
    if (operation.done) return operation;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error("Veo generation timed out; existing operation can be resumed without submitting another generation");
}

export async function downloadVeoVideos(operation: any, context?: { userId?: string; model?: string; reservationId?:string }) {
  if (operation.name?.startsWith("openrouter:")) return downloadRouterVideo(operation, context?.userId, context?.model, context?.reservationId);
  const samples = operation.response?.generateVideoResponse?.generatedSamples ?? operation.response?.generatedVideos ?? [];
  const outputs: { buffer: Buffer; contentType: string; metadata: any }[] = [];
  for (const sample of samples) {
    const uri = sample.video?.uri ?? sample.video?.downloadUri;
    const inline = sample.video?.videoBytes;
    if (inline) outputs.push({ buffer: Buffer.from(inline, "base64"), contentType: "video/mp4", metadata: sample });
    else if (uri) {
      const response = await fetchVeoDownload(uri);
      if (!response.ok) throw new Error("Failed to download generated video");
      outputs.push({ buffer: Buffer.from(await response.arrayBuffer()), contentType: "video/mp4", metadata: sample });
    }
  }
  if (outputs.length === 0) throw new Error("Veo returned no downloadable videos");
  for (const output of outputs) output.metadata = { ...output.metadata, ...await inspectNativeVideo(output.buffer) };
  return outputs;
}

export async function fetchVeoDownload(uri: string, request: typeof fetch = fetch) {
  let url = new URL(uri);
  const signal = AbortSignal.timeout(120000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !(url.hostname === "generativelanguage.googleapis.com" || url.hostname === "storage.googleapis.com" || url.hostname.endsWith(".googleusercontent.com"))) throw new Error("Unexpected provider download host");
    // Signed storage redirects must not receive the Gemini API key.
    const headers: Record<string, string> = url.hostname === "generativelanguage.googleapis.com" ? { "x-goog-api-key": env.GEMINI_API_KEY ?? "" } : {};
    const response = await request(url, { headers, redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Provider download redirect is missing its destination");
    url = new URL(location, url);
  }
  throw new Error("Too many provider download redirects");
}
