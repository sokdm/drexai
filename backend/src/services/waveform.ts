import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { editorAssetBytes } from "./videoEditing.js";
import { probeMedia, runMedia } from "./ffmpeg.js";
export function waveformPeaks(log: string, bins = 120) {
 const levels = [...log.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?inf|[-\d.]+)/g)].map(m => Number.isFinite(Number(m[1])) ? Math.min(1, Math.pow(10, Number(m[1]) / 20)) : 0);
 if (!levels.length) throw new Error("No audio waveform was measured");
 return Array.from({ length: Math.min(bins, levels.length) }).map((_, i, array) => Math.max(...levels.slice(Math.floor(i * levels.length / array.length), Math.max(Math.floor(i * levels.length / array.length) + 1, Math.floor((i + 1) * levels.length / array.length)))));
}
export async function measureWaveform(asset: any) {
 if ((asset.sizeBytes || 0) > 100 * 1024 * 1024) throw new Error("Waveform analysis supports sources up to 100 MB");
 const dir = await mkdtemp(path.join(tmpdir(), "drex-waveform-"));
 try {
  const bytes = await editorAssetBytes(asset); if (bytes.length > 100 * 1024 * 1024) throw new Error("Source exceeds waveform size limit");
  const source = path.join(dir, "source"); await writeFile(source, bytes);
  const info = await probeMedia(source); if (!info.audio || info.duration > 3600) throw new Error("Select an audio source up to one hour");
  await runMedia("ffmpeg", ["-hide_banner", "-nostdin", "-i", source, "-vn", "-af", "aresample=8000,asetnsamples=n=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=levels.txt", "-f", "null", "-"], { cwd: dir });
  return { peaks: waveformPeaks(await readFile(path.join(dir, "levels.txt"), "utf8")), duration: info.duration };
 } finally { await rm(dir, { recursive: true, force: true }); }
}
