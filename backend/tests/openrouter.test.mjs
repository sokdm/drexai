import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { z } from "zod";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { env } from "../dist/config/env.js";
import { routerText, routerImages, routerSpeech, checkCapability, routerResponse, GatewayUsage, GatewayBinding } from "../dist/services/openrouter.js";
import { createRouterVideo, pollRouterVideo, downloadRouterVideo, downloadRouterContent } from "../dist/services/openrouterVideo.js";
import { geminiJson } from "../dist/services/gemini.js";
import { generateGeminiImages } from "../dist/services/imageGeneration.js";
import { generateGeminiSpeech, wavDuration } from "../dist/services/textToSpeech.js";
import { managedPrice, approvedTerms, rememberQuote } from "../dist/services/managedPricing.js";
import { defaultModel, withProvider } from "../dist/services/platformControl.js";
import { GenerationPriceRule } from "../dist/models/GenerationPriceRule.js";
import { ProviderControl } from "../dist/models/Admin.js";
import { runMedia } from "../dist/services/ffmpeg.js";
const original = globalThis.fetch, originalKey = env.OPENROUTER_API_KEY;
let db, dir, mp3, video, png, fail = false, requests = [], pricingAvailable = false, blockGoogle = false, textFinish = "stop";
const models = [
 { id: "openai/gpt-4.1-mini", top_provider: { max_completion_tokens: 16000 }, architecture: { output_modalities: ["text"] }, supported_parameters: ["max_tokens", "response_format", "reasoning"], pricing: { prompt: "0.0000004", completion: "0.0000016" } },
 { id: "google/gemini-3.8-flash", architecture: { input_modalities: ["text", "image", "video"], output_modalities: ["text"] }, supported_parameters: ["max_tokens", "response_format"], pricing: { prompt: "0.000001", completion: "0.000002" } },
 { id: "google/gemini-3.8-flash-tts", architecture: { output_modalities: ["speech"] }, pricing: { prompt: "0.00001" } }
];
const image = { id: "google/gemini-nano-banana-2.1", architecture: { output_modalities: ["image"] }, supported_parameters: { resolution: { type: "enum", values: ["1K", "2K"] }, aspect_ratio: { type: "enum", values: ["16:9", "1:1"] }, input_references: { type: "range", min: 0, max: 14 } } };
before(async () => {
 env.OPENROUTER_API_KEY = "test-router-key";
 db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 60000 }], binary: { downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(db.getUri("gateway_tests"));
 dir = await mkdtemp(path.join(tmpdir(), "drex-router-test-"));
 png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).png().toBuffer();
 await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", path.join(dir, "speech.mp3")]); mp3 = await readFile(path.join(dir, "speech.mp3"));
 await runMedia("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=854x480:r=24:d=4", "-f", "lavfi", "-i", "sine=frequency=700:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "native.mp4")]); video = await readFile(path.join(dir, "native.mp4"));
 globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url); assert.equal(u.origin, "https://openrouter.ai");
  if (u.pathname === "/api/v1/models") return Response.json({ data: models });
  if (u.pathname === "/api/v1/images/models") return Response.json({ data: [image, { ...image, id: "google/gemini-3-pro-image" }, { ...image, id: "black-forest-labs/flux-3-image-klein" }] });
  if (u.pathname === "/api/v1/videos/models") return Response.json({ data: [{ id: "google/veo-3.1", supported_durations: [4, 6, 8], supported_resolutions: ["720p", "1080p"], supported_aspect_ratios: ["16:9", "9:16"] }] });
  if (u.pathname.endsWith("/endpoints")) {
   if (u.pathname.includes("gemini-3-pro-image")) return Response.json({ endpoints: [{ provider_name: "Google", pricing: [{ billable: "output_image", unit: "token", cost_usd: ".00003" }] }] });
   if (u.pathname.includes("flux-3-image-klein")) return Response.json({ endpoints: [{ provider_name: "BFL", pricing: [{ billable: "output_image", unit: "image", cost_usd: ".009", variant: "1k" }] }] });
   return pricingAvailable ? Response.json({ endpoints: [{ provider_name: "Test", pricing: [{ billable: "output_image", unit: "image", cost_usd: "0.04" }] }] }) : Response.json({}, { status: 503 });
  }
  assert.equal(options.headers.Authorization, "Bearer test-router-key");
  const body = options.body ? JSON.parse(options.body) : undefined; requests.push({ path: u.pathname, body });
  if (fail) return Response.json({ error: { message: "Quota test failure" } }, { status: 429 });
  if (blockGoogle && body?.model?.startsWith("google/") && u.pathname.endsWith("chat/completions")) return Response.json({ error: { message: "Paid model training violation (account settings)" } }, { status: 404 });
  if (u.pathname.endsWith("chat/completions")) return Response.json({ id: textFinish === "length" ? "text-truncated" : "text-1", choices: [{ message: { content: '{"title":"Valid script"}' }, finish_reason: textFinish }], usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: textFinish === "length" ? 4990 : 0 } } });
  if (u.pathname === "/api/v1/images") return Response.json({ data: [{ b64_json: png.toString("base64"), media_type: "image/png" }], usage: { cost: 0.04 } });
  if (u.pathname.endsWith("audio/speech")) return new Response(mp3, { headers: { "content-type": "audio/mpeg" } });
  if (u.pathname === "/api/v1/videos") return Response.json({ id: "job-1", status: "pending" }, { status: 202 });
  if (u.pathname.endsWith("/content")) return new Response(video);
  if (u.pathname === "/api/v1/videos/job-1") return Response.json({ id: "job-1", status: "completed", usage: { cost: 0.4 } });
  throw new Error("Unexpected test request");
 };
});
after(async () => { globalThis.fetch = original; env.OPENROUTER_API_KEY = originalKey; await mongoose.disconnect(); await db?.stop(); if (dir) await rm(dir, { recursive: true, force: true }); });
test("text and structured scripts use OpenRouter, validated output and reported cost", async () => {
 const result = await geminiJson({ model: "openrouter/google/gemini-3.8-flash", system: "Script", prompt: "Scene", schema: z.object({ title: z.string() }) });
 assert.equal(result.title, "Valid script"); const request = requests.at(-1).body;
 assert.equal(request.response_format.type, "json_schema"); assert.equal(request.generation_config, undefined); assert.equal(request.provider.allow_fallbacks, false);
 assert.equal((await GatewayUsage.findOne({ kind: "text" })).costUsd, 0.001);
});
test("approved non-Google text fallback handles privacy rejection without relaxing privacy", async () => {
 blockGoogle = true;
 try {
  const value = await routerText({ model: "openrouter/google/gemini-3.8-flash", system: "s", prompt: "p", requestLimits: { maxInputTokens: 20000, maxOutputTokens: 12000, maxPrice: { prompt: 1, completion: 2 }, fallbacks: [{ model: "openrouter/openai/gpt-4.1-mini", maxPrice: { prompt: .4, completion: 1.6 } }] } });
  assert.match(value, /Valid script/); assert.equal(requests.at(-1).body.model, "openai/gpt-4.1-mini"); assert.equal(requests.at(-1).body.provider.data_collection, undefined); assert.equal(requests.at(-1).body.provider.max_price.completion, 1.6);
  await assert.rejects(() => routerText({ model: "openrouter/google/gemini-3.8-flash", system: "s", prompt: "p" }), /privacy policy blocks/);
 } finally { blockGoogle = false; }
});
test("images and character references are normalized to stored-compatible PNG bytes", async () => {
 const result = await generateGeminiImages({ model: "openrouter/google/gemini-nano-banana-2.1", prompt: "Scene", numberOfImages: 2, resolution: "1K", aspectRatio: "16:9", referenceImages: [{ contentType: "image/png", data: png.toString("base64") }] });
 assert.equal(result.length, 2); assert.equal(result[0].contentType, "image/png"); assert.equal((await sharp(result[0].buffer).metadata()).format, "png");
 const body = requests.at(-1).body; assert.ok(body.input_references[0].image_url.url.startsWith("data:image/png;base64,")); assert.equal(body.response_format, undefined);
 const count = requests.length; await assert.rejects(() => routerImages({ model: "openrouter/google/gemini-nano-banana-2.1", resolution: "4K", aspectRatio: "16:9" }), /does not support/); assert.equal(requests.length, count);
});
test("voiceovers decode MP3 into actual WAV with measured duration; direct voice integration remains", async () => {
 const result = await generateGeminiSpeech({ model: "openrouter/google/gemini-3.8-flash-tts", mode: "single", text: "Hello", voiceId: "Kore", language: "English", style: "calm" });
 assert.equal(result.contentType, "audio/wav"); assert.ok(wavDuration(result.buffer) > 0.9); assert.equal(requests.at(-1).body.response_format, "mp3");
 assert.equal((await GatewayUsage.findOne({ kind: "voice" })).costUsd, undefined);
});
test("video job ID persists through polling and content contains inspected native sound", async () => {
 const id = await createRouterVideo({ model: "openrouter/google/veo-3.1", motionPrompt: "A speaking adult", dialogueLines: [{ speaker: "Daniel", text: "Welcome home" }], quality: "720p", aspectRatio: "16:9", durationSeconds: 4, sourceImageBytes: png.toString("base64"), sourceImageMimeType: "image/png" });
 assert.equal(id, "openrouter:job-1"); const body = requests.at(-1).body; assert.equal(body.generate_audio, true); assert.equal(body.frame_images[0].frame_type, "first_frame"); assert.equal(body.durationSeconds, undefined);
 const result = await downloadRouterVideo(await pollRouterVideo(id)); assert.equal(result[0].metadata.nativeAudio, true); assert.equal(result[0].metadata.audioReview.status, "needs_review"); assert.ok(result[0].buffer.equals(video));
});
test("unsupported settings and unknown pricing fail closed without a paid request", async () => {
 const count = requests.length;
 await assert.rejects(() => routerText({ model: "openrouter/nonexistent", system: "s", prompt: "p" }), /not verified/);
 await assert.rejects(() => createRouterVideo({ model: "openrouter/google/veo-3.1", durationSeconds: 20 }), /capability/);
 assert.throws(() => checkCapability(image, "unsupported", true), /does not support/);
 await assert.rejects(() => managedPrice("text_to_image", "openrouter", { model: "openrouter/google/gemini-nano-banana-2.1", resolution: "1K", numberOfImages: 1 }, 2), /pricing is unavailable/);
 assert.equal(requests.length, count);
});
test("credit rule and approved quote remain stable when defaults and prices change", async () => {
 pricingAvailable = true;
 const { CreditPackage } = await import("../dist/models/CreditPackage.js"), { PricingPolicy } = await import("../dist/models/Finance.js"), { defaultPricingPolicy } = await import("../dist/services/creditPricingEngine.js");
 await CreditPackage.create({ key: "creator", name: "Creator", credits: 5000, amount: 90, currency: "USD", active: true });
 const model = "openrouter/google/gemini-nano-banana-2.1", userId = new mongoose.Types.ObjectId();
 await GenerationPriceRule.create({ feature: "text_to_image", provider: "openrouter", model, unit: "image:1K", creditsPerUnit: 8, providerCostUsd: 0.04, active: true });
 const settings = { model, resolution: "1K", numberOfImages: 2 }; const quote = await managedPrice("text_to_image", "openrouter", settings, 2); assert.equal(quote.credits, 14);
 await rememberQuote(userId, settings, quote); await PricingPolicy.create({ _id: "global", revision: 2, values: { ...defaultPricingPolicy, markup: 12 } });
 assert.equal((await approvedTerms(userId, settings, 14, () => managedPrice("text_to_image", "openrouter", settings, 2))).credits, 14);
 await GatewayBinding.create({ _id: "story_generation", model: "openrouter/google/gemini-3.8-flash" }); assert.equal(await defaultModel("story_generation", "legacy"), "openrouter/google/gemini-3.8-flash");
});
test("unbounded Google image pricing proposes a verified compatible FLUX quote before approval", async () => {
 const quote = await managedPrice("text_to_image", "openrouter", { model: "openrouter/google/gemini-3-pro-image", resolution: "1K", aspectRatio: "16:9", numberOfImages: 1 }, 2);
 assert.equal(quote.model, "openrouter/black-forest-labs/flux-3-image-klein"); assert.equal(quote.requestedModel, "openrouter/google/gemini-3-pro-image"); assert.equal(quote.estimatedCostUsd, .009); assert.ok(quote.credits >= 5);
});
test("provider limits remain enforced and explicit failures are not blindly replayed", async () => {
 const model = "openrouter/google/gemini-3.8-flash"; await ProviderControl.create({ provider: "openrouter", model, enabled: false });
 await assert.rejects(() => withProvider(model, () => routerText({ model, system: "s", prompt: "p" })), /disabled/);
 fail = true; const count = requests.length; await assert.rejects(() => routerResponse("images", { model: "test" }), /429/); assert.equal(requests.length, count + 1); fail = false;
});
test("download redirects cannot leak the gateway key or reach private hosts", async () => {
 const calls = [];
 const request = async (url, options) => { calls.push({ url: String(url), options }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/public/video" } }) : new Response(video); };
 await downloadRouterContent("job-1", request); assert.equal(calls[1].options.headers.Authorization, undefined);
 await assert.rejects(() => downloadRouterContent("job-1", async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })), /Unexpected/);
});

test("admin gateway routing requires admin session and CSRF, validates modality, and persists audited feature choices", async () => {
 const { default: express } = await import("express"), { default: cookieParser } = await import("cookie-parser");
 const { adminRouter } = await import("../dist/routes/admin.js"), { User } = await import("../dist/models/User.js"), { AdminSession, AdminAudit } = await import("../dist/models/Admin.js"), { hashSecret } = await import("../dist/utils/crypto.js"), { errorHandler } = await import("../dist/middleware/errorHandler.js");
 const user = await User.create({ displayName: "Gateway admin", email: "gateway-admin@example.test", passwordHash: "test", role: "admin", status: "active" });
 await AdminSession.create({ userId: user._id, tokenHash: hashSecret("gateway-admin-session"), csrfHash: hashSecret("csrf"), expiresAt: new Date(Date.now() + 60000) });
 const app = express(); app.use(express.json(), cookieParser()); app.use("/api/admin", adminRouter); app.use(errorHandler);
 const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
 const url = "http://127.0.0.1:" + server.address().port + "/api/admin/gateway-binding";
 const body = JSON.stringify({ feature: "ai_channel_analysis", model: "openrouter/google/gemini-3.8-flash", reason: "Reviewed gateway model capabilities" });
 try {
  assert.equal((await original(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body })).status, 401);
  assert.equal((await original(url, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: "drex_admin=gateway-admin-session" }, body })).status, 403);
  const headers = { "Content-Type": "application/json", Cookie: "drex_admin=gateway-admin-session", "x-admin-csrf": "csrf" };
  assert.equal((await original(url, { method: "PUT", headers, body })).status, 200);
  assert.equal((await GatewayBinding.findById("ai_channel_analysis")).model, "openrouter/google/gemini-3.8-flash");
  assert.ok(await AdminAudit.exists({ action: "gateway-binding", target: "ai_channel_analysis" }));
  assert.equal((await original(url, { method: "PUT", headers, body: JSON.stringify({ feature: "ai_channel_analysis", model: "", reason: "Restore configured provider default" }) })).status, 200);
  assert.equal(await GatewayBinding.findById("ai_channel_analysis"), null);
  assert.notEqual((await original(url, { method: "PUT", headers, body: JSON.stringify({ feature: "voice", model: "openrouter/google/gemini-3.8-flash", reason: "Invalid modality must be rejected" }) })).status, 200);
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("script requests use the approved output allowance and timeout, and send reasoning only when supported", async () => {
 const originalTimeout = AbortSignal.timeout, timeouts = [];
 await ProviderControl.updateOne({model:"openrouter/google/gemini-3.8-flash"}, {enabled:true});
 AbortSignal.timeout = ms => { timeouts.push(ms); return originalTimeout(ms); };
 try {
  await routerText({ model:"openrouter/openai/gpt-4.1-mini",system:"Script",prompt:"Write two scenes",maxOutputTokens:12000,timeoutMs:180000,reasoningEffort:"low",requestLimits:{maxInputTokens:20000,maxOutputTokens:12000} });
  assert.equal(requests.at(-1).body.max_tokens,12000); assert.deepEqual(requests.at(-1).body.reasoning,{effort:"low"}); assert.ok(timeouts.includes(180000));
  await routerText({model:"openrouter/openai/gpt-4.1-mini",system:"Script",prompt:"Write",maxOutputTokens:30000,requestLimits:{maxInputTokens:20000,maxOutputTokens:30000}}); assert.equal(requests.at(-1).body.max_tokens,16000);
  await routerText({ model:"openrouter/google/gemini-3.8-flash",system:"Script",prompt:"Write two scenes",maxOutputTokens:12000,reasoningEffort:"low",requestLimits:{maxInputTokens:20000,maxOutputTokens:3000} });
  assert.equal(requests.at(-1).body.max_tokens,3000); assert.equal(requests.at(-1).body.reasoning,undefined);
 } finally { AbortSignal.timeout = originalTimeout; await ProviderControl.updateOne({model:"openrouter/google/gemini-3.8-flash"}, {enabled:false}); }
});
test("truncated output records its actual finish reason and reported reasoning usage", async () => {
 textFinish="length";
 try { await assert.rejects(routerText({model:"openrouter/openai/gpt-4.1-mini",system:"Script",prompt:"Write",maxOutputTokens:5000}), error => { assert.equal(error.code,"INCOMPLETE_PROVIDER_OUTPUT"); assert.equal(error.finishReason,"length"); assert.equal(error.usage.completion_tokens_details.reasoning_tokens,4990); assert.match(error.message,/output limit: 5000/); return true; });
 const usage=await GatewayUsage.findOne({requestId:"text-truncated"}); assert.equal(usage.usage.finish_reason,"length"); assert.equal(usage.costUsd,.001);
 } finally { textFinish="stop"; }
});
