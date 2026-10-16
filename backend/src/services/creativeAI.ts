import { geminiFetch } from "./geminiRequest.js";
import { env } from "../config/env.js";
import { withProvider } from "./platformControl.js";
export async function creativeJson(model: string, prompt: string, media: any[]) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini is not configured");
  return withProvider(model, async () => {
    const response = await geminiFetch("https://generativelanguage.googleapis.com/v1beta/interactions", { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: [...media, { type: "text", text: prompt + " Return only valid JSON, no markdown." }], generation_config: { max_output_tokens: 16000 } }), signal: AbortSignal.timeout(300000) }, 300000);
    const data = await response.json() as any;
    if (!response.ok) throw new Error("Media analysis provider could not complete the request");
    const raw = data.output_text || data.outputs?.flatMap((o: any) => o.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("") || "";
    return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, ""));
  });
}
