import { isOpenRouter, routerImages } from "./openrouter.js";
import { geminiFetch } from "./geminiRequest.js";
import { withProvider } from "./platformControl.js";
import { env } from "../config/env.js";

const directImageModels = [
  { id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1", aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"], resolutions: ["1K", "2K", "4K"], maxImages: 10, characterReference: true },
  { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite", aspectRatios: ["1:1", "16:9", "9:16"], resolutions: ["1K"], maxImages: 4, characterReference: false },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro", aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"], resolutions: ["1K", "2K", "4K"], maxImages: 10, characterReference: true }
];

const alternativeImageModels = [
 { id: "openrouter/black-forest-labs/flux-3-image-klein", label: "FLUX 3 Klein", aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"], resolutions: ["1K", "2K", "4K"], maxImages: 10, characterReference: true },
 { id: "openrouter/bytedance-seed/seedream-5-0-flash", label: "Seedream 5 Flash", aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"], resolutions: ["1K", "2K"], maxImages: 10, characterReference: true }
];
const routerImageModels = directImageModels.map(m => ({ ...m, id: "openrouter/google/" + m.id, label: m.label + " via OpenRouter" }));
export const imageModels = env.OPENROUTER_API_KEY ? [...alternativeImageModels, ...routerImageModels, ...directImageModels] : [...directImageModels, ...alternativeImageModels, ...routerImageModels];

export const stylePresets = ["Cinematic", "Anime", "Photoreal", "3D animation", "Documentary", "Editorial", "Concept art"];

export function validateImageSettings(input: any) {
  const model = imageModels.find((item) => item.id === input.model);
  if (!model) throw new Error("Unsupported image model");
  if (!model.aspectRatios.includes(input.aspectRatio)) throw new Error("Unsupported aspect ratio for selected model");
  if (!model.resolutions.includes(input.resolution)) throw new Error("Unsupported resolution for selected model");
  const count = Number(input.numberOfImages ?? 1);
  if (count < 1 || count > model.maxImages) throw new Error(`Selected model supports 1-${model.maxImages} images per request`);
  if ((input.characterReferenceIds?.length || input.sourceAssetIds?.length) && !model.characterReference) throw new Error("Selected model does not support character references");
  if (!String(input.prompt ?? "").trim()) throw new Error("Prompt is required");
  return { ...input, model: model.id, numberOfImages: count };
}

export function imageCreditCost(settings: any) {
  const resolutionMultiplier = settings.resolution === "4K" ? 4 : settings.resolution === "2K" ? 2 : 1;
  const modelMultiplier = settings.model === "gemini-3-pro-image" ? 3 : settings.model === "gemini-3.1-flash-lite-image" ? 1 : 2;
  return Number(settings.numberOfImages) * resolutionMultiplier * modelMultiplier;
}

export async function generateGeminiImages(settings: any) { return withProvider(settings.model, () => isOpenRouter(settings.model) ? routerImages(settings) : generateGeminiImagesUnchecked(settings)); }
async function generateGeminiImagesUnchecked(settings: any) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const prompt = `${settings.prompt}\nStyle: ${settings.stylePreset || "natural"}\nAspect ratio: ${settings.aspectRatio}\nResolution: ${settings.resolution}`;
  const outputs: { buffer: Buffer; contentType: string }[] = [];
  for (let index = 0; index < settings.numberOfImages; index += 1) {
    const response = await geminiFetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model: settings.model || env.GEMINI_IMAGE_MODEL, input: [{ type: "text", text: prompt }, ...(settings.referenceImages ?? []).map((image: any) => ({ type: "image", mime_type: image.contentType, data: image.data }))], response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: settings.aspectRatio, image_size: settings.resolution } })
    }, 180000);
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error?.message ?? "Gemini image generation failed"), { providerRejected: response.status < 500 });
    const image = findImage(data);
    const base64 = image?.data;
    if (!base64) throw new Error("Provider returned no image data");
    const buffer = Buffer.from(base64, "base64");
    const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (!png && !(buffer[0] === 255 && buffer[1] === 216)) throw new Error("Provider returned an unsupported image file");
    outputs.push({ buffer, contentType: png ? "image/png" : "image/jpeg" });
  }
  return outputs;
}

function findImage(value: any): any {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.data === "string" && (value.type === "image" || value.mime_type?.startsWith("image/"))) return value;
  if (value.output_image?.data) return value.output_image;
  if (value.outputImage?.data) return value.outputImage;
  for (const child of Array.isArray(value) ? value : [value.outputs, value.steps, value.content, value.output, value.interaction]) { const found = findImage(child); if (found) return found; }
}
