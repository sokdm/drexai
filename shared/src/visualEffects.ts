export function effectValues(clip: { look?: string; brightness?: number; contrast?: number; saturation?: number; sharpen?: number; vignette?: boolean }) {
  const presets: Record<string, [number, number, number]> = { original: [0, 1, 1], cinematic: [-.03, 1.15, .8], vivid: [0, 1.1, 1.3], monochrome: [0, 1.05, 0], warm: [.025, 1.03, 1.15], cool: [-.015, 1.05, .85] };
  const [brightness, contrast, saturation] = presets[clip.look || "original"] || presets.original;
  return { brightness: clip.brightness ?? brightness, contrast: clip.contrast ?? contrast, saturation: clip.saturation ?? saturation, sharpen: clip.sharpen ?? 0, vignette: clip.vignette ?? false };
}
