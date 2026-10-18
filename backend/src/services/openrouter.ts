import { readProviderStream } from "./providerStream.js";
import { env } from "../config/env.js";
import mongoose, { Schema, model } from "mongoose";
import { geminiSchema } from "./geminiSchema.js";
import type { z } from "zod";
import sharp from "sharp";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeMedia, runMedia } from "./ffmpeg.js";

export const isOpenRouter = (id: string) => id?.startsWith("openrouter/");
export const routerId = (id: string) => id.replace(/^openrouter\//, "");
export const providerFor = (id: string) => isOpenRouter(id) ? "openrouter" : id?.startsWith("veo-") ? "google-veo" : id === "heygen-avatar" ? "heygen" : id === "ffmpeg" ? "ffmpeg" : "gemini";
const base = "https://openrouter.ai/api/v1/";
export const GatewayBinding = model("GatewayBinding", new Schema({ _id: String, model: String, updatedBy: Schema.Types.ObjectId }, { timestamps: true }));
const gatewayUsageSchema = new Schema({ model: String, userId: Schema.Types.ObjectId, reservationId: { type: Schema.Types.ObjectId, index: true }, requestId: String, kind: String, costUsd: Number, usage: Schema.Types.Mixed, status: String }, { timestamps: true });
gatewayUsageSchema.index({ requestId: 1, kind: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });
export const GatewayUsage = model("GatewayUsage", gatewayUsageSchema);
const cache = new Map<string, { expires: number; value: any }>();
export async function routerCatalog(kind: "text" | "image" | "video" | "voice" | "transcription") {
  const endpoint = kind === "image" ? "images/models" : kind === "video" ? "videos/models" : "models";
  const cached = cache.get(endpoint); if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("OpenRouter model discovery is unavailable. Existing direct integrations remain available.");
  const data = await response.json(); if (!Array.isArray(data.data)) throw new Error("Invalid OpenRouter catalog");
  cache.set(endpoint, { expires: Date.now() + 300000, value: data.data }); return data.data;
}
export async function verifiedRouterModel(id: string, kind: "text" | "image" | "video" | "voice" | "transcription") {
  const models = await routerCatalog(kind), record = models.find((m: any) => m.id === routerId(id));
  const modality = kind === "voice" ? "speech" : kind;
  if (!record || (kind !== "video" && !record.architecture?.output_modalities?.includes(modality))) throw new Error(`OpenRouter model is not verified for ${kind}`);
  return record;
}
export function checkCapability(record: any, key: string, value: any) {
  const descriptor = record.supported_parameters?.[key];
  if (!descriptor || descriptor.type === "enum" && !descriptor.values?.includes(value) || descriptor.type === "range" && (!Number.isInteger(value) || value < descriptor.min || value > descriptor.max)) throw new Error(`OpenRouter model does not support ${key}=${value}`);
}
export async function routerResponse(endpoint: string, body?: any, timeout = 180000) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured on this service");
  if (!/^(chat\/completions|images|audio\/(?:speech|transcriptions)|videos(?:\/[\w-]+(?:\/content\?index=0)?)?)$/.test(endpoint)) throw new Error("Invalid OpenRouter endpoint");
  const response = await fetch(base + endpoint, { method: body ? "POST" : "GET", redirect: "error", headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (body && mongoose.connection.readyState === 1) await GatewayUsage.create({ model: "openrouter/" + body.model, kind: endpoint === "chat/completions" ? "text" : endpoint === "images" ? "image" : endpoint === "audio/speech" ? "voice" : endpoint === "audio/transcriptions" ? "transcription" : "video", status: "failed", usage: { httpStatus: response.status, costUnknown: true } });
    console.warn(JSON.stringify({event:"openrouter_rejected",endpoint,model:body?.model,status:response.status,requestId:response.headers.get("x-request-id"),parameters:body?Object.keys(body):[]}));
    const detail = String(data.error?.message || "Review provider access, balance and model availability");
    const privacy = /training violation|guardrail restrictions|data policy/i.test(detail);
    const definiteTextFailure = endpoint === "chat/completions" && response.status === 503 && !!data.error && !data.id && !data.generation_id;
    throw Object.assign(new Error(privacy ? "Your OpenRouter account privacy policy blocks this model's available provider. Choose another model in Admin / Providers, or review https://openrouter.ai/settings/privacy. Your privacy settings were not changed." : `OpenRouter request failed (${response.status}): ${detail.slice(0, 500)}`), { providerRejected: response.status < 500 || definiteTextFailure, status: response.status, privacyBlocked: privacy });
  }
  return response;
}
export async function recordRouterUsage(id: string, kind: string, data: any, userId?: string, reservationId?: string) {
  if (mongoose.connection.readyState !== 1) return;
  const value = data.usage?.cost, costUsd = (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
  const requestId = data.id || data.generation_id, values = { model: id, kind, userId, reservationId, ...(requestId ? { requestId } : {}), usage: { ...(data.usage || {}), ...(data.choices?.[0]?.finish_reason ? { finish_reason: data.choices[0].finish_reason } : {}) }, costUsd, status: "completed" };
  if (requestId) await GatewayUsage.updateOne({ requestId, kind }, { $setOnInsert: values }, { upsert: true }); else await GatewayUsage.create(values);
}
type TextInput = { reasoningEffort?: "low"; timeoutMs?: number; reservationId?: string; onDelta?: (text: string) => void; model: string; system: string; prompt: string; maxOutputTokens?: number; schema?: z.ZodSchema; media?: any[]; userId?: string; requestLimits?: { freeDeadlineMs?: number; maxInputTokens: number; maxOutputTokens: number; maxPrice?: any; fallbacks?: { model: string; maxPrice: any; supportsImages?:boolean }[] } };
export async function routerText(input: TextInput) {
 const { withProvider, assertProviderBudget } = await import("./platformControl.js");
 const candidates = [{ model: input.model, maxPrice: input.requestLimits?.maxPrice }, ...(input.requestLimits?.fallbacks || []).filter(f=>!input.media?.length || f.supportsImages===true && input.media.every(m=>m.type==="image_url"))];
 for (let index = 0; index < candidates.length; index++) {
  const candidate = candidates[index];
  const free = input.requestLimits?.freeDeadlineMs ? (await import("./freeAiLimits.js")).verifiedFreeText(await verifiedRouterModel(candidate.model,"text")) : false;
  let emitted=false;
  try {
   if (index) await assertProviderBudget(candidate.model, (input.requestLimits as any)?.approvedCostUsd);
   return await withProvider(candidate.model, () => routerTextAttempt({ ...input, timeoutMs: free ? input.requestLimits!.freeDeadlineMs : input.timeoutMs, ...(input.onDelta ? {onDelta:(text:string)=>{if(text)emitted=true;input.onDelta!(text);}} : {}), model: candidate.model, requestLimits: input.requestLimits ? { ...input.requestLimits, maxPrice: candidate.maxPrice } : undefined }));
  } catch (error: any) {
   console.warn(JSON.stringify({event:"text_route_failure",model:candidate.model,status:error.status,code:error.code,name:error.name,emitted,nextApproved:index<candidates.length-1}));
   const freeTimeout=free && !emitted && /abort|timeout|timed out/i.test(error.message);
   const freeQuota=free && (error.code === "FREE_AI_LIMIT" || error.code === "INCOMPLETE_PROVIDER_OUTPUT");
   if (index === candidates.length - 1 || emitted || !(freeTimeout || freeQuota || error.providerRejected && [404,429,503].includes(error.status))) throw error;
  }
 }
 throw new Error("No approved text model is available");
}
async function routerTextAttempt(input: TextInput) {
  const record = await verifiedRouterModel(input.model, "text"), supported = record.supported_parameters || [];
  if (!supported.includes("max_tokens")) throw new Error("Choose an OpenRouter model with a supported output token limit");
  if (input.schema && !supported.includes("response_format")) throw new Error("Choose an OpenRouter text model with structured output support");
  const body: any = { model: routerId(input.model), messages: [{ role: "system", content: input.system }, { role: "user", content: input.media?.length ? [{ type: "text", text: input.prompt }, ...input.media] : input.prompt }], provider: { require_parameters: true, allow_fallbacks: !!input.requestLimits?.maxPrice, ...(input.requestLimits?.maxPrice ? { max_price: input.requestLimits.maxPrice } : {}) } };
  const limits = input.requestLimits || { maxInputTokens: 20000, maxOutputTokens: 12000 };
  const jsonSchema=input.schema?geminiSchema(input.schema):undefined;
  const nativeSchema=Boolean(input.schema && supported.includes("structured_outputs"));
  if(input.schema && !nativeSchema)body.messages[0].content += "\nReturn one JSON object matching this schema exactly (no markdown): "+JSON.stringify(jsonSchema);
  const inputBytes = Buffer.byteLength(body.messages[0].content + input.prompt, "utf8");
  if (inputBytes > limits.maxInputTokens) throw new Error("Input exceeds this quote's conservative text token limit. Shorten the context or obtain a new verified quote.");
  if (supported.includes("max_tokens")) body.max_tokens = Math.min(input.maxOutputTokens ?? 5000, limits.maxOutputTokens);
  const modelOutputLimit = Number(record.top_provider?.max_completion_tokens ?? record.max_completion_tokens);
  if (Number.isFinite(modelOutputLimit) && modelOutputLimit > 0) body.max_tokens = Math.min(body.max_tokens, Math.floor(modelOutputLimit));
  if (input.reasoningEffort && supported.includes("reasoning")) body.reasoning = { effort: input.reasoningEffort };
  if (input.schema) body.response_format = nativeSchema ? { type: "json_schema", json_schema: { name: "drex_result", strict: false, schema: jsonSchema } } : {type:"json_object"};
  const { verifiedFreeText, admitFreeAi } = await import("./freeAiLimits.js");
  if (verifiedFreeText(record)) {
    // Exact free model, no paid route substitutions; every retry consumes shared quota.
    body.provider.allow_fallbacks = false;
    await admitFreeAi(input.userId);
  }
  if (input.onDelta) { body.stream = true; const response = await routerResponse("chat/completions", body, input.timeoutMs ?? 90000); const result = await readProviderStream(response, input.onDelta); await recordRouterUsage(input.model, "text", result, input.userId, input.reservationId); return result.text; }
  const response = await routerResponse("chat/completions", body, input.timeoutMs ?? 90000), data = await response.json();
  await recordRouterUsage(input.model, "text", data, input.userId, input.reservationId);
  const result = data.choices?.[0]?.message?.content;
  const finishReason = data.choices?.[0]?.finish_reason;
  if (typeof result !== "string" || !result.trim() || finishReason === "length") {
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
    const reason = finishReason === "length" ? "reached its output token limit" : finishReason === "content_filter" ? "filtered the response" : "returned no usable text";
    throw Object.assign(new Error(`OpenRouter ${reason} (model: ${input.model}, finish reason: ${finishReason || "unknown"}, output limit: ${body.max_tokens}${typeof reasoningTokens === "number" ? `, reasoning tokens: ${reasoningTokens}` : ""}). Completed work was not replaced.`), { code: "INCOMPLETE_PROVIDER_OUTPUT", finishReason, maxOutputTokens: body.max_tokens, usage: data.usage, requestId: data.id });
  }
  return result;
}
export async function routerImages(settings: any) {
  const record = await verifiedRouterModel(settings.model, "image");
  checkCapability(record, "resolution", settings.resolution); checkCapability(record, "aspect_ratio", settings.aspectRatio);
  const refs = settings.referenceImages ?? []; if (refs.length) checkCapability(record, "input_references", refs.length);
  const outputs = [];
  for (let index = 0; index < settings.numberOfImages; index++) {
    const body: any = { model: routerId(settings.model), prompt: `${settings.prompt}\nStyle: ${settings.stylePreset || "natural"}`, resolution: settings.resolution, aspect_ratio: settings.aspectRatio };
    if (refs.length) body.input_references = refs.map((image: any) => ({ type: "image_url", image_url: { url: `data:${image.contentType};base64,${image.data}` } }));
    if (settings.background) { checkCapability(record, "background", settings.background); body.background = settings.background; }
    const response = await routerResponse("images", body), data = await response.json();
    await recordRouterUsage(settings.model, "image", data, settings.userId, settings.reservationId);
    if (!data.data?.[0]?.b64_json) throw new Error("OpenRouter returned no image bytes");
    const buffer = Buffer.from(data.data[0].b64_json, "base64"), meta = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format || "")) throw new Error("OpenRouter returned an unsupported image format");
    if (settings.background === "transparent" && (!meta.hasAlpha || (await sharp(buffer).stats()).isOpaque)) throw new Error("The provider did not return a transparent image. Background removal could not be confirmed.");
    // Normalize raster outputs for existing asset and recovery paths.
    outputs.push({ buffer: await sharp(buffer).png().toBuffer(), contentType: "image/png", providerData: { usage: data.usage, gateway: "openrouter" } });
  }
  return outputs;
}
export async function routerSpeech(settings: any) {
  await verifiedRouterModel(settings.model, "voice");
  // The shipped adapter exposes the existing documented Gemini voice roster only.
  if (!/^google\/gemini-3\.8-flash(?:-lite)?-tts$/.test(routerId(settings.model))) throw new Error("This speech model does not have a verified voice configuration");
  const input = settings.mode === "multi" ? settings.speakers.map((s: any) => ({ text: s.text, voice: s.voice, instructions: s.style || settings.style })) : settings.text;
  const response = await routerResponse("audio/speech", { model: routerId(settings.model), input, voice: settings.voiceId, instructions: `${settings.style || "natural"}. Language: ${settings.language}`, response_format: "mp3" });
  const bytes = Buffer.from(await response.arrayBuffer()), directory = await mkdtemp(path.join(tmpdir(), "drex-router-speech-"));
  try {
    const source = path.join(directory, "source.mp3"), file = path.join(directory, "narration.wav"); await writeFile(source, bytes);
    await runMedia("ffmpeg", ["-nostdin", "-y", "-i", source, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", file]);
    const probe = await probeMedia(file); if (!probe.audio || !probe.duration) throw new Error("OpenRouter returned unreadable speech");
    await recordRouterUsage(settings.model, "voice", { id: response.headers.get("x-request-id"), usage: {} }, settings.userId, settings.reservationId);
    return { buffer: await readFile(file), contentType: "audio/wav", durationSeconds: probe.duration, providerData: { gateway: "openrouter", usage: {}, costStatus: "unavailable_in_binary_response" } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
