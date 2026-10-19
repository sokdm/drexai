import { isOpenRouter, routerSpeech } from "./openrouter.js";
import { withProvider } from "./platformControl.js";
import { env } from "../config/env.js";

const directTtsModels = [
  { id: "gemini-3.8-flash-tts", label: "Gemini 3.8 Flash TTS", multiSpeaker: true, voices: ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"], styles: ["calm", "cinematic", "warm narrator", "dramatic", "whispered", "energetic", "documentary"], languages: ["English", "Spanish", "French", "Portuguese", "Hindi", "Arabic", "Yoruba"] },
  { id: "gemini-3.8-flash-lite-tts", label: "Gemini 3.8 Flash-Lite TTS", multiSpeaker: true, voices: ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda"], styles: ["calm", "friendly", "fast", "slow", "dramatic"], languages: ["English", "Spanish", "French", "Portuguese"] }
];

const routerTtsModels = directTtsModels.map(m => ({ ...m, id: "openrouter/google/" + m.id, label: m.label + " via OpenRouter" }));
routerTtsModels.unshift({id:"openrouter/elevenlabs/eleven-flash-v2.5",label:"ElevenLabs Flash v2.5 via OpenRouter",multiSpeaker:false,voices:["george","sarah","adam","alice","bella","bill","brian","callum","charlie","chris","daniel","eric","harry","jessica","laura","liam","lily","matilda","river","roger","will"],styles:[],languages:["English","Spanish","French","Portuguese","Hindi","Arabic","German","Italian","Japanese","Korean","Chinese","Dutch","Polish","Turkish"]});
routerTtsModels.unshift({...routerTtsModels[0],id:"openrouter/elevenlabs/eleven-turbo-v2",label:"ElevenLabs Turbo v2 via OpenRouter",languages:["English"]});
export const ttsModels = env.OPENROUTER_API_KEY ? [...routerTtsModels, ...directTtsModels] : [...directTtsModels, ...routerTtsModels];

export function validateTtsSettings(input: any) {
  const model = ttsModels.find((item) => item.id === input.model);
  if (!model) throw new Error("Unsupported speech model");
  if(model.id.startsWith("openrouter/elevenlabs/")&&String(input.text||"").length>(model.id.endsWith("eleven-turbo-v2")?30000:40000))throw new Error("Split narration into sections of at most 40,000 characters");
  if (!model.voices.includes(input.voiceId)) throw new Error("Unsupported voice for selected model");
  if (!model.languages.includes(input.language)) throw new Error("Unsupported language for selected model");
  if (input.mode === "multi" && !model.multiSpeaker) throw new Error("Selected model does not support multi-speaker dialogue");
  if (!String(input.text ?? "").trim() && !(input.speakers?.length)) throw new Error("Text is required");
  return { ...input, model: model.id };
}

export function ttsCreditCost(settings: any) {
  const chars = settings.mode === "multi" ? (settings.speakers ?? []).map((s: any) => s.text ?? "").join(" ").length : String(settings.text ?? "").length;
  return Math.max(1, Math.ceil(chars / 600));
}

export async function generateGeminiSpeech(settings: any) { return withProvider(settings.model, () => isOpenRouter(settings.model) ? routerSpeech(settings) : generateGeminiSpeechUnchecked(settings)); }
async function generateGeminiSpeechUnchecked(settings: any) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const isMulti = settings.mode === "multi" && settings.speakers?.length;
  const content = isMulti
    ? settings.speakers.map((speaker: any) => ({ type: "text", text: speaker.text, annotations: [{ type: "speech_metadata", speaker: speaker.speaker, style: speaker.style ?? settings.style }] }))
    : [{ type: "text", text: settings.text, annotations: [{ type: "speech_metadata", style: settings.style }] }];
  const speechConfig = isMulti
    ? { mode: "conversational", speakers: settings.speakers.map((speaker: any) => ({ speaker: speaker.speaker, voice: speaker.voice })) }
    : [{ voice: settings.voiceId }];
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({ model: settings.model || env.GEMINI_TTS_MODEL, input: [{ type: "user_input", content }], response_format: { type: "audio" }, generation_config: { speech_config: speechConfig } })
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message ?? "Gemini TTS failed"), { providerRejected: response.status < 500 });
  const base64 = data.output_audio?.data ?? findAudio(data);
  if (!base64) throw new Error("Provider returned no audio");
  const buffer = Buffer.from(base64, "base64");
  return { buffer, contentType: "audio/wav", durationSeconds: wavDuration(buffer), providerData: data };
}

function findAudio(data: any): string | undefined {
  for (const step of data.steps ?? []) for (const item of step.content ?? []) if (item.type === "audio" && item.data) return item.data;
}

export function wavDuration(buffer: Buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("Provider returned invalid WAV audio");
  let byteRate = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + size > buffer.length) throw new Error("Incomplete WAV audio");
    if (name === "fmt " && size >= 16) byteRate = buffer.readUInt32LE(offset + 16);
    if (name === "data") dataSize += size;
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) throw new Error("Audio duration could not be measured");
  return dataSize / byteRate;
}
