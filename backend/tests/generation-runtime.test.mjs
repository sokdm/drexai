import { test } from "node:test";
import assert from "node:assert/strict";
import { extractText } from "../dist/services/gemini.js";
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
