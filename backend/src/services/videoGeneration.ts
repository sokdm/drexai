import { withProvider } from "./platformControl.js";
import { env } from "../config/env.js";

export const videoModels = [
  { id: "veo-3.1-generate-preview", label: "Veo 3.1", aspectRatios: ["16:9", "9:16"], durations: [8], qualities: ["720p", "1080p", "4K"], maxQuantity: 2, imageToVideo: true }
];

export function validateVideoSettings(input: any) {
  const model = videoModels.find((item) => item.id === input.model) ?? videoModels[0];
  if (!model.aspectRatios.includes(input.aspectRatio)) throw new Error("Unsupported aspect ratio for selected Veo model");
  if (!model.durations.includes(Number(input.durationSeconds))) throw new Error("Unsupported duration for selected Veo model");
  if (!model.qualities.includes(input.quality)) throw new Error("Unsupported output quality for selected Veo model");
  const quantity = Number(input.quantity ?? 1);
  if (quantity < 1 || quantity > model.maxQuantity) throw new Error(`Selected model supports 1-${model.maxQuantity} outputs`);
  if (!String(input.motionPrompt ?? "").trim()) throw new Error("Motion prompt is required");
  if (!input.sourceImageAssetId && !input.sourceImageUrl) throw new Error("Select or upload a source image first");
  return { ...input, model: model.id, quantity, durationSeconds: Number(input.durationSeconds) };
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

export async function createVeoOperation(settings: any) { return withProvider(settings.model, () => createVeoOperationUnchecked(settings)); }
async function createVeoOperationUnchecked(settings: any) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const body: any = {
    instances: [{ prompt: settings.motionPrompt, ...(settings.sourceImageBytes ? { image: { inlineData: { data: settings.sourceImageBytes, mimeType: settings.sourceImageMimeType ?? "image/png" } } } : {}) }],
    parameters: { aspectRatio: settings.aspectRatio, sampleCount: settings.quantity, durationSeconds: settings.durationSeconds, resolution: String(settings.quality).toLowerCase() }
  };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message ?? "Veo request failed"), { providerRejected: response.status < 500 });
  if (!data.name) throw new Error("Veo did not return an operation ID");
  return data.name as string;
}

export async function pollVeoOperation(operationName: string, timeoutMs = 12 * 60 * 1000) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!/^(?:models\/[\w.-]+\/)?operations\/[\w.-]+$/.test(operationName)) throw new Error("Invalid provider operation name");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY }, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "Veo polling failed");
    if (data.done && data.error) throw Object.assign(new Error(data.error.message ?? "Veo generation failed"), { providerRejected: true });
    if (data.done) return data;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error("Veo generation timed out");
}

export async function downloadVeoVideos(operation: any) {
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
