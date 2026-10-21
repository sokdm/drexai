import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeMedia, runMedia } from "./ffmpeg.js";

export async function inspectNativeVideo(buffer: Buffer, requireAudio = true) {
  const directory = await mkdtemp(path.join(tmpdir(), "drex-native-audio-"));
  try {
    const file = path.join(directory, "scene.mp4"); await writeFile(file, buffer);
    const probe = await probeMedia(file);
    if(!requireAudio){if(!probe.video||!(probe.duration>0))throw Object.assign(new Error("Generated video is unreadable or incomplete"),{mediaRejected:true});return {durationSeconds:probe.duration,width:probe.width,height:probe.height,nativeAudio:probe.audio,audioReview:{status:"not_requested",audioTrackDetected:probe.audio}};}
    if (!probe.video || !probe.audio || !(probe.duration > 0)) throw Object.assign(new Error("Veo output is incomplete: readable video and native audio tracks are required. Review and regenerate with a new quote."), { mediaRejected: true });
    const volume = await runMedia("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-vn", "-f", "null", "-"], { timeoutMs: 60000, includeStderr: true });
    const match = volume.match(/max_volume:\s*(-?inf|-?[\d.]+) dB/), peak = match?.[1] === "-inf" ? -1000 : Number(match?.[1]);
    if (!match || !Number.isFinite(peak) || peak < -60) throw Object.assign(new Error("Veo soundtrack is silent or could not be inspected. Review and regenerate with a new quote."), { mediaRejected: true });
    return { durationSeconds: probe.duration, width: probe.width, height: probe.height, nativeAudio: true, audioReview: { status: "needs_review", audioTrackDetected: true, peakDb: peak, dialoguePresence: "unverified", speakerIdentity: "unverified", timing: "unverified", lipSync: "requires_human_review", note: "Listen to the complete clip and check the words, speakers, voice consistency and mouth synchronization. Track detection does not verify dialogue." } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
