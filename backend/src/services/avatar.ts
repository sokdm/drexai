import { env } from "../config/env.js";
import { withProvider } from "./platformControl.js";
import { z } from "zod";
const presenterSchema = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(100), voiceId: z.string().min(1).max(200), ownerEmail: z.string().email().optional(), authorizationReference: z.string().min(5).optional() });
export function availablePresenters(email: string) {
  const entries = z.array(presenterSchema).max(100).parse(JSON.parse(env.AVATAR_PRESENTERS_JSON || "[]"));
  return entries.filter(p => !p.ownerEmail || p.ownerEmail.toLowerCase() === email.toLowerCase() && !!p.authorizationReference);
}
export async function avatarRequest(endpoint: string, body?: unknown) {
  if (!env.HEYGEN_API_KEY) throw new Error("Talking avatar provider is not configured");
  const response = await fetch("https://api.heygen.com" + endpoint, { method: body ? "POST" : "GET", headers: { "X-Api-Key": env.HEYGEN_API_KEY, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const data = await response.json() as any;
  if (!response.ok || data.error) throw new Error("Talking avatar provider rejected the request");
  return data.data;
}
export async function submitAvatar(job: any) {
  return withProvider("heygen-avatar", async () => {
    const data = await avatarRequest("/v2/video/generate", { title: job.name, dimension: job.options.ratio === "9:16" ? { width: 720, height: 1280 } : { width: 1280, height: 720 }, video_inputs: [{ character: { type: "avatar", avatar_id: job.options.presenterId, avatar_style: "normal" }, voice: { type: "text", input_text: job.options.script, voice_id: job.options.voiceId } }], caption: true });
    if (!data?.video_id) throw new Error("Avatar provider did not confirm a video ID");
    return String(data.video_id);
  });
}
