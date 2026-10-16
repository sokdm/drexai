import { test } from "node:test";
import assert from "node:assert/strict";
import { extractText, parseJson, scriptProjectSchema } from "../dist/services/gemini.js";
import { requireQueueWorker } from "../dist/services/queueReadiness.js";
import { redisConnection } from "../dist/services/redisConnection.js";
import { env } from "../dist/config/env.js";
test("Gemini response extraction reads output text rather than serializing its envelope", () => {
  assert.equal(extractText({ output_text: "script" }), "script");
  assert.equal(extractText({ outputs: [{ type: "text", text: '{"title":"Script"}' }] }), '{"title":"Script"}');
  assert.equal(extractText({ steps: [{ type: "model_output", content: [{ type: "text", text: "First" }, { type: "text", text: "Second" }] }] }), "First\nSecond");
  assert.throws(() => extractText({ status: "failed" }), /no text/);
});
test("unconfigured Redis and missing workers give actionable errors before generation", async () => {
  const previous = env.REDIS_URL;
  try { env.REDIS_URL = "REPLACE_WITH_RENDER_INTERNAL_REDIS_URL"; assert.throws(() => redisConnection(), /actual Render Key Value/); } finally { env.REDIS_URL = previous; }
  await assert.rejects(() => requireQueueWorker({ getWorkers: async () => [] }), /start the matching/);
  await assert.rejects(() => requireQueueWorker({ getWorkers: async () => { throw new Error("offline"); } }), /Generation queue is unavailable/);
  await requireQueueWorker({ getWorkers: async () => [{ id: "worker" }] });
});

test("Gemini output schema requires character and scene objects and handles encoded JSON", async () => {
  const { geminiSchema } = await import("../dist/services/geminiSchema.js"); const schema = geminiSchema(scriptProjectSchema);
  assert.equal(schema.properties.characters.items.type, "object"); assert.equal(schema.properties.scenes.items.type, "object"); assert.ok(schema.required.includes("title"));
  assert.deepEqual(parseJson(JSON.stringify(JSON.stringify({ title: "Script" }))), { title: "Script" });
});
test("a media worker refuses missing environment variables before claiming readiness", async () => {
  const { assertMediaWorkerConfig } = await import("../dist/services/mediaWorkerConfig.js");
  assert.throws(() => assertMediaWorkerConfig({}), /MONGODB_URI/);
  const settings = Object.fromEntries(["MONGODB_URI", "REDIS_URL", "GEMINI_API_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].map(key => [key, "configured"]));
  assertMediaWorkerConfig(settings); settings.REDIS_URL = "REPLACE_WITH_RENDER_INTERNAL_REDIS_URL"; assert.throws(() => assertMediaWorkerConfig(settings), /REDIS_URL/);
});

test("Gemini retries explicit busy responses but never replays network failures", async () => {
 const { geminiFetch } = await import("../dist/services/geminiRequest.js"); const original = globalThis.fetch; let calls = 0;
 try {
  globalThis.fetch = async () => new Response("{}", { status: ++calls < 3 ? 503 : 200 });
  assert.equal((await geminiFetch("https://example.test", {}, 90000, async () => {})).status, 200); assert.equal(calls, 3);
  calls = 0; globalThis.fetch = async () => { calls++; throw new Error("network"); };
  await assert.rejects(() => geminiFetch("https://example.test", {}, 90000, async () => {}), /network/); assert.equal(calls, 1);
  calls = 0; globalThis.fetch = async () => { calls++; return new Response("{}", {status: 400}); };
  assert.equal((await geminiFetch("https://example.test", {}, 90000, async () => {})).status, 400); assert.equal(calls, 1);
 } finally { globalThis.fetch = original; }
});
