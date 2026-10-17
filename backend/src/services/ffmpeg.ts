import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { EditorTimeline, ExportSettings, outputDimensions, timelineDuration, trackStart } from "@drex/shared";
import { env } from "../config/env.js";
import { effectValues } from "@drex/shared";

const require = createRequire(import.meta.url);
export function mediaBinary(tool: "ffmpeg" | "ffprobe"): string {
  return tool === "ffmpeg" ? env.FFMPEG_PATH || require("ffmpeg-static") : env.FFPROBE_PATH || require("ffprobe-static").path;
}
export function runMedia(tool: "ffmpeg" | "ffprobe", args: string[], options: { cwd?: string; signal?: AbortSignal; onProgress?: (seconds: number) => void; timeoutMs?: number; includeStderr?: boolean; stderrLimit?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(mediaBinary(tool), args, { cwd: options.cwd, windowsHide: true, shell: false, signal: options.signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", progress = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${tool} exceeded processing time limit`)); }, options.timeoutMs ?? 30 * 60000);
    child.stdout.on("data", chunk => {
      stdout = (stdout + chunk).slice(-2 * 1024 * 1024);
      progress += chunk.toString(); const lines = progress.split(/\r?\n/); progress = lines.pop() ?? "";
      for (const line of lines) if (line.startsWith("out_time_us=")) { const value = Number(line.slice(12)); if (Number.isFinite(value)) options.onProgress?.(value / 1000000); }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-(options.stderrLimit ?? 8000)); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve(options.includeStderr ? stdout + "\n" + stderr : stdout) : reject(new Error(`${tool} failed (${code}): ${stderr.slice(-2000)}`)); });
  });
}
export async function probeMedia(file: string) {
  const data = JSON.parse(await runMedia("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,wav,mp3,flac,ogg,matroska,image2,png_pipe,jpeg_pipe,webp_pipe", "-show_format", "-show_streams", "-of", "json", file], { timeoutMs: 30000 }));
  const video = data.streams?.find((s: any) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = data.streams?.find((s: any) => s.codec_type === "audio");
  return { duration: Number(data.format?.duration || video?.duration || audio?.duration || 0), width: Number(video?.width || 0), height: Number(video?.height || 0), video: Boolean(video), audio: Boolean(audio), videoCodec: video?.codec_name, audioCodec: audio?.codec_name };
}
export async function renderCapabilities() {
  const [filters, encoders] = await Promise.all([runMedia("ffmpeg", ["-hide_banner", "-filters"], { timeoutMs: 15000 }), runMedia("ffmpeg", ["-hide_banner", "-encoders"], { timeoutMs: 15000 })]);
  if (!/\bass\s/.test(filters) || !/\blibx264\s/.test(encoders) || !/\baac\s/.test(encoders)) throw new Error("FFmpeg requires libass, libx264 and AAC support");
  return { resolutions: ["480p", "720p", "1080p"], formats: ["mp4"], maxDuration: 3600, captions: true };
}
function assTime(seconds: number) { const cs = Math.round(seconds * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; }
function assText(text: string) { return text.replace(/\\/g, "＼").replace(/{/g, "｛").replace(/}/g, "｝").replace(/\r?\n/g, "\\N").replace(/[\x00-\x08\x0b-\x1f]/g, ""); }
export function subtitleDocument(timeline: EditorTimeline, width: number, height: number) {
  let doc = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,36,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,24,24,28,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  doc = doc.replace("\n\n[Events]", "\nStyle: Boxed,Arial,36,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,3,8,0,2,24,24,28,1\n\n[Events]");
  function event(text: string, start: number, end: number, style: any) {
    const alignment = { top: 8, center: 5, bottom: 2 }[style.position as "top"];
    const animation = style.animation === "pop" ? "\\fscx85\\fscy85\\t(0,150,\\fscx100\\fscy100)" : style.animation === "fade" ? "\\fad(120,120)" : "";
    const tags = `${animation}\\fn${style.font}\\fs${Math.round(style.size * height / 720)}\\an${alignment}\\b${style.preset === "bold" ? 1 : 0}\\bord${style.preset === "boxed" ? 8 : 2}\\shad0${style.preset === "boxed" ? "\\3a&H40&" : ""}`;
    doc += `Dialogue: 0,${assTime(start)},${assTime(end)},${style.preset === "boxed" ? "Boxed" : "Default"},,0,0,0,,{${tags}}${assText(text)}\n`;
  }
  let offset = 0;
  for (const clip of timeline.clips) { if (clip.text.trim()) event(clip.text, offset, offset + clip.duration, clip.textStyle); offset += clip.duration; }
  for (const caption of timeline.captions) { const start = trackStart(timeline, caption); event(caption.text, start, Math.min(timelineDuration(timeline), start + caption.end - caption.start), caption.style); }
  return doc;
}

export async function renderTimeline(timeline: EditorTimeline, settings: ExportSettings, sources: Map<string, string>, directory: string, onProgress: (progress: number) => void = () => {}, signal?: AbortSignal) {
  const total = timelineDuration(timeline), [width, height] = outputDimensions(timeline.aspectRatio, settings.resolution);
  if (!timeline.clips.length) throw new Error("Add at least one clip before exporting");
  const common = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2", "-filter_threads", "1"];
  const segments: string[] = [];
  let elapsed = 0;
  for (const [i, clip] of timeline.clips.entries()) {
    const file = clip.assetId ? sources.get(clip.assetId) : undefined;
    if (clip.kind !== "title" && !file) throw new Error("Missing visual source");
    const args = [...common];
    if (clip.kind === "title") args.push("-f", "lavfi", "-i", `color=c=0x111827:s=${width}x${height}:r=30:d=${clip.duration}`);
    else if (clip.kind === "image") args.push("-loop", "1", "-framerate", "30", "-i", file!);
    else args.push("-ss", String(clip.sourceIn), "-i", file!);
    const scale = clip.fit === "cover" ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)*${clip.cropX ?? 0.5}:(ih-oh)/2` : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
    const fade = Math.min(0.3, clip.duration / 3);
    const effects = effectValues(clip);
    const filters = `${scale},setsar=1,fps=30,format=yuv420p,setpts=(PTS-STARTPTS)/${clip.speed ?? 1},eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}${effects.sharpen ? `,unsharp=5:5:${effects.sharpen}` : ""}${effects.vignette ? ",vignette=PI/5" : ""}${clip.transition === "fade" ? `,fade=t=in:st=0:d=${fade},fade=t=out:st=${clip.duration - fade}:d=${fade}` : ""}`;
    const segment = `segment-${i}.mp4`; segments.push(segment);
    const frames = Math.max(1, Math.round((elapsed + clip.duration) * 30) - Math.round(elapsed * 30)); elapsed += clip.duration;
    args.push("-frames:v", String(frames), "-vf", filters, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", segment);
    await runMedia("ffmpeg", args, { cwd: directory, signal }); onProgress(5 + (i + 1) / timeline.clips.length * 45);
  }
  await writeFile(path.join(directory, "segments.txt"), segments.map(file => `file '${file}'`).join("\n"));
  await writeFile(path.join(directory, "captions.ass"), subtitleDocument(timeline, width, height));
  const args = [...common, "-filter_complex_threads", "1", "-f", "concat", "-safe", "1", "-i", "segments.txt", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  const tracks = timeline.audio.filter(a => !a.muted && a.volume > 0 && trackStart(timeline, a) < total);
  for (const audio of tracks) { const file = sources.get(audio.assetId); if (!file) throw new Error("Missing audio source"); args.push("-i", file); }
  const nativeTracks: { inputIndex: number; sourceIn: number; duration: number; start: number; volume: number; speed: number }[] = [];
  let start = 0;
  for (const clip of timeline.clips) {
    if (clip.kind === "video" && clip.sourceAudio === true && !clip.sourceMuted && (clip.sourceVolume ?? 1) > 0) {
      const file = sources.get(clip.assetId!); if (!file) throw new Error("Missing native audiovisual source");
      const probe = await probeMedia(file);
      if (!probe.audio && clip.nativeDialogue) throw new Error("Native dialogue clip has no audio track; regenerate or review before export");
      if (probe.audio) { args.push("-i", file); nativeTracks.push({ inputIndex: tracks.length + nativeTracks.length + 2, sourceIn: clip.sourceIn, duration: clip.duration, start, speed: clip.speed ?? 1, volume: clip.sourceVolume ?? 1 }); }
    }
    start += clip.duration;
  }
  const graphs = [`[1:a]atrim=duration=${total},asetpts=PTS-STARTPTS[base]`];
  tracks.forEach((a, i) => {
    const length = Math.min(a.duration, total - trackStart(timeline, a));
    graphs.push(`[${i + 2}:a]atrim=start=${a.sourceIn}:duration=${length},asetpts=PTS-STARTPTS,aresample=48000,volume=${a.volume}${a.fadeIn > 0 ? `,afade=t=in:d=${Math.min(a.fadeIn, length)}` : ""}${a.fadeOut > 0 ? `,afade=t=out:st=${Math.max(0, length - a.fadeOut)}:d=${Math.min(a.fadeOut, length)}` : ""},adelay=${Math.round(trackStart(timeline, a) * 1000)}:all=1[a${i}]`);
  });
  nativeTracks.forEach((a, i) => graphs.push(`[${a.inputIndex}:a:0]atrim=start=${a.sourceIn}:duration=${a.duration * a.speed},asetpts=PTS-STARTPTS,atempo=${Math.max(.5, Math.min(2, a.speed))}${a.speed < .5 || a.speed > 2 ? `,atempo=${a.speed / Math.max(.5, Math.min(2, a.speed))}` : ""},aresample=48000,volume=${a.volume},adelay=${Math.round(a.start * 1000)}:all=1[n${i}]`));
  graphs.push(`[base]${nativeTracks.map((_, i) => `[n${i}]`).join("")}${tracks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tracks.length + nativeTracks.length + 1}:duration=first:normalize=0,alimiter=limit=0.95:level=false:latency=true[aout]`);
  args.push("-filter_complex", graphs.join(";"), "-vf", "ass=captions.ass", "-map", "0:v:0", "-map", "[aout]", "-t", String(total), "-c:v", "libx264", "-preset", "veryfast", "-crf", String({ draft: 28, standard: 23, high: 18 }[settings.quality]), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-progress", "pipe:1", "output.mp4");
  await runMedia("ffmpeg", args, { cwd: directory, signal, onProgress: seconds => onProgress(50 + Math.min(1, seconds / total) * 40) });
  const output = path.join(directory, "output.mp4"), info = await probeMedia(output), size = (await stat(output)).size;
  if (!info.video || !info.audio || info.videoCodec !== "h264" || info.audioCodec !== "aac" || info.width !== width || info.height !== height || Math.abs(info.duration - total) > 0.15 || size < 100) throw new Error("Rendered MP4 did not pass stream, duration or resolution checks");
  return { file: output, ...info, sizeBytes: size };
}
