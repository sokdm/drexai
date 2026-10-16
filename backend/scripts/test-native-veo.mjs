// Explicit opt-in, one request per case, no generation retries, no wallet/production DB writes.
import { GoogleGenAI } from "@google/genai";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { env } from "../dist/config/env.js";
import { veoRequest, pollVeoOperation, downloadVeoVideos } from "../dist/services/videoGeneration.js";
const directory = new URL("../test-artifacts/native-veo-live/", import.meta.url);
if (process.env.NATIVE_VEO_LIVE_TEST !== "true") throw new Error("Set NATIVE_VEO_LIVE_TEST=true to authorize up to three eight-second, 720p paid Veo clips.");
if (!env.GEMINI_API_KEY || /REPLACE|test-only/.test(env.GEMINI_API_KEY)) throw new Error("A real GEMINI_API_KEY is required.");
await mkdir(directory, { recursive: true });
const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: 60000, retryOptions: { attempts: 1 } } });
const results = [];
try {
  // Check access first, without a paid generation request.
  await client.models.get({ model: "veo-3.1-generate-preview" });
  for (const test of [
    { name: "A-one-speaker", motionPrompt: "A fictional adult Nigerian man in a green jacket outside a house. Medium close-up of his face.", preferredAccent: "Natural Nigerian English", dialogueLines: [{ speaker: "Daniel", text: "Welcome home. I have been waiting for you." }], environmentalSounds: "Quiet birds" },
    { name: "B-two-speakers", motionPrompt: "Two fictional adult friends, Daniel in green and Ada in blue, outside a house. Focus on each speaking face.", dialogueLines: [{ speaker: "Daniel", text: "Where have you been?" }, { speaker: "Ada", text: "I was at the market." }], preferredAccent: "Natural Nigerian English", environmentalSounds: "Soft wind" },
    { name: "C-environment", motionPrompt: "Trees swaying beside an empty garden path. Slow camera pan. No people.", dialogueLines: [], environmentalSounds: "Rustling leaves, gentle wind, distant birds" }
  ]) {
    const checkpoint = new URL(test.name + ".json", directory);
    let prior; try { prior = JSON.parse(await readFile(checkpoint, "utf8")); } catch {}
    if (prior?.submitted && !prior.operationName) throw new Error(test.name + ": earlier submission is uncertain; do not repeat automatically.");
    let operationName = prior?.operationName;
    if (!operationName) {
      await writeFile(checkpoint, JSON.stringify({ submitted: true }));
      const operation = await client.models.generateVideos(veoRequest({ ...test, model: "veo-3.1-generate-preview", quantity: 1, durationSeconds: 8, quality: "720p", aspectRatio: "16:9" }));
      operationName = operation.name; await writeFile(checkpoint, JSON.stringify({ submitted: true, operationName }));
    }
    console.log(test.name + ": polling existing generation");
    const completed = await pollVeoOperation(operationName);
    const [output] = await downloadVeoVideos(completed);
    await writeFile(new URL(test.name + ".mp4", directory), output.buffer);
    results.push({ name: test.name, streams: output.metadata, review: "Audio track and peak level inspected; audible words, speaker identity and lip-sync require human playback review." });
    await writeFile(new URL("report.json", directory), JSON.stringify(results, null, 2));
    console.log(test.name + ": native soundtrack detected; human review required");
  }
} catch (error) {
  // Never print provider request objects, headers or API keys.
  const message = String(error.message || "Provider request failed").split(env.GEMINI_API_KEY).join("[redacted]");
  await writeFile(new URL("failure.json", directory), JSON.stringify({ status: error.status, message, completedCases: results.length, note: "No success claimed for remaining cases." }, null, 2));
  console.error("Live Veo check could not complete: " + message); process.exitCode = 1;
}
