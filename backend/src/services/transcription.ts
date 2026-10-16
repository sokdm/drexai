import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runMedia } from "./ffmpeg.js";
import { verifiedRouterModel, routerResponse, routerId, recordRouterUsage } from "./openrouter.js";
import { withProvider, assertProviderBudget } from "./platformControl.js";
const segment = z.object({ start: z.number().finite().nonnegative(), end: z.number().finite().positive(), text: z.string().max(5000), speaker: z.union([z.string(), z.number()]).optional() });
export function parseTranscript(data: unknown, duration: number, offset = 0) {
 const parsed = z.object({ text: z.string(), segments: z.array(segment).max(2000) }).parse(data);
 if (parsed.segments.some(s => s.end <= s.start || s.end > duration + .2)) throw new Error("Transcription returned out-of-range timestamps");
 if (parsed.text.trim() && !parsed.segments.length) throw new Error("Selected transcription provider did not return segment timestamps");
 return parsed.segments.map(s => ({ ...s, start: s.start + offset, end: Math.min(duration, s.end) + offset }));
}
export async function transcribeSource(source: string, duration: number, directory: string, terms: any, userId: string, progress: (n: number) => Promise<void>) {
 if (duration > 3600 || !terms?.allowed || terms.feature !== "full_video_transcription") throw new Error("Approve a full-video transcription quote first");
 await verifiedRouterModel(terms.model, "transcription"); await assertProviderBudget(terms.model, terms.estimatedCostUsd);
 const segments = [];
 for (let offset = 0; offset < duration; offset += 60) {
  const length = Math.min(60, duration - offset), file = path.join(directory, `speech-${offset}.mp3`);
  await runMedia("ffmpeg", ["-y", "-nostdin", "-ss", String(offset), "-i", source, "-t", String(length), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", file]);
  const data = await withProvider(terms.model, async () => {
   const response = await routerResponse("audio/transcriptions", { model: routerId(terms.model), input_audio: { data: (await readFile(file)).toString("base64"), format: "mp3" }, response_format: "verbose_json", timestamp_granularities: ["segment"] }, 90000);
   const value = await response.json(); await recordRouterUsage(terms.model, "transcription", { ...value, id: response.headers.get("x-generation-id") || value.id }, userId); return value;
  });
  segments.push(...parseTranscript(data, length, offset)); await progress((offset + length) / duration);
 }
 return { text: segments.map(s => s.text).join(" "), segments, model: terms.model, duration, generatedAt: new Date().toISOString(), timing: "provider-segments" };
}
