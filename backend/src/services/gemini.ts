import { withProvider, defaultModel } from "./platformControl.js";
import { z } from "zod";
import { env } from "../config/env.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const channelAnalysisSchema = z.object({
  mainNiche: z.string(),
  keywords: z.array(z.string()).default([]),
  contentGaps: z.array(z.object({ topic: z.string(), evidence: z.string(), opportunity: z.string() })).default([]),
  audienceInterests: z.array(z.string()).default([]),
  contentBriefs: z.array(z.object({ title: z.string(), audience: z.string(), hook: z.string(), outline: z.array(z.string()), keywords: z.array(z.string()), rationale: z.string() })).default([]),
  contentThemes: z.array(z.string()),
  commonVideoFormats: z.array(z.string()),
  publishingPatterns: z.string(),
  popularTopics: z.array(z.string()),
  audiencePositioningInference: z.string(),
  titlePatterns: z.array(z.string()),
  creativeOpportunities: z.array(z.string()),
  potentialNicheIdeas: z.array(z.object({ name: z.string(), rationale: z.string() })),
  limitations: z.array(z.string())
});

export const scriptProjectSchema = z.object({
  title: z.string(),
  storyConcept: z.string(),
  summary: z.string(),
  characters: z.array(z.object({
    name: z.string(),
    appearance: z.string().optional(),
    clothing: z.string().optional(),
    personality: z.string().optional(),
    voicePreference: z.string().optional()
  })).default([]),
  scenes: z.array(z.object({
    order: z.number(),
    title: z.string(),
    sceneDescription: z.string(),
    characters: z.array(z.string()).default([]),
    narration: z.string(),
    dialogue: z.string().default(""),
    imagePrompt: z.string(),
    videoMotionPrompt: z.string(),
    cameraDirection: z.string(),
    estimatedNarrationTiming: z.string(),
    audioSuggestions: z.string(),
    transitionSuggestions: z.string()
  })).min(1)
});

export function assertGeminiReady() {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
}

export async function geminiJson<T>(input: {
  system: string;
  prompt: string;
  schema: z.ZodSchema<T>;
  model?: string;
  maxOutputTokens?: number;
}) {
  assertGeminiReady();
  const selectedModel = input.model || await defaultModel("text", env.GEMINI_MODEL);
  const raw = await withProvider(selectedModel, () => withRetry(async () => {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        system_instruction: input.system,
        input: `${input.prompt}\n\nReturn ONLY valid JSON. Do not wrap in markdown.`,
        generation_config: { max_output_tokens: input.maxOutputTokens ?? 5000, thinking_level: "low" }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "Gemini request failed");
    return data.output_text ?? extractText(data);
  }));
  const parsed = parseJson(raw);
  return input.schema.parse(parsed);
}

export async function geminiText(input: { system: string; prompt: string; maxOutputTokens?: number; model?: string }) {
  assertGeminiReady();
  const selectedModel = input.model || await defaultModel("text", env.GEMINI_MODEL);
  return withProvider(selectedModel, () => withRetry(async () => {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        system_instruction: input.system,
        input: input.prompt,
        generation_config: { max_output_tokens: input.maxOutputTokens ?? 2500, thinking_level: "low" }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "Gemini request failed");
    return data.output_text ?? extractText(data);
  }));
}

export function extractText(data: any): string {
  if (typeof data.output_text === "string") return data.output_text;
  const parts: string[] = [];
  function collect(value: any) { if (!value || typeof value !== "object") return; if (value.type === "text" && typeof value.text === "string") { parts.push(value.text); return; } if (Array.isArray(value)) value.forEach(collect); else for (const key of ["outputs", "content", "steps", "output"]) if (value[key]) collect(value[key]); }
  collect(data); if (!parts.length) throw new Error("Gemini returned no text. Review provider access and model configuration."); return parts.join("\n");
}

function parseJson(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  return JSON.parse(trimmed);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 0): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index <= attempts; index += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (index + 1)));
    }
  }
  if (lastError instanceof Error && ["TimeoutError", "AbortError"].includes(lastError.name)) throw new Error("Gemini did not finish within 90 seconds. The request failed; try again with a shorter script.");
  throw lastError;
}
