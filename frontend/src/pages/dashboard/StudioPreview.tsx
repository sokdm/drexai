import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

export function StudioPreview({ timeline, urls, aspectRatio = "16:9" }: { timeline: any[]; urls: Record<string, string>; aspectRatio?: string }) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const total = timeline.reduce((sum, s) => sum + s.durationSeconds, 0);
  const scene = timeline.find(s => time >= s.startSeconds && time < s.startSeconds + s.durationSeconds) ?? timeline[timeline.length - 1];
  const local = time - (scene?.startSeconds ?? 0);
  const clip = scene?.clips.find((c: any) => local >= c.startSeconds && local < c.startSeconds + c.durationSeconds);
  const track = scene?.audio.find((a: any) => local >= a.startSeconds && local < a.startSeconds + a.durationSeconds);
  useEffect(() => { setPlaying(false); setTime(0); }, [total]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    function tick(now: number) {
      const delta = Math.min((now - previous) / 1000, 0.1); previous = now;
      if ((!video.current || video.current.readyState >= 3) && (!audio.current || audio.current.readyState >= 3)) setTime(value => Math.min(total, value + delta));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);
  useEffect(() => {
    if (time >= total && total > 0) setPlaying(false);
    for (const [element, item] of [[video.current, clip], [audio.current, track]] as const) {
      if (!element || !item) continue;
      const desired = Math.max(0, local - item.startSeconds);
      if (element.readyState >= 1 && Math.abs(element.currentTime - desired) > 0.35) element.currentTime = desired;
      if (playing && element.paused) void element.play().catch(() => { setPlaying(false); setError("Playback paused. Press play to continue."); });
      if (!playing) element.pause();
    }
  }, [time, playing, clip, track, local, total]);
  function playbackError() { setPlaying(false); setError("A media file could not load. Refresh the production to renew its preview link."); }
  const ready = timeline.every(s => Boolean(urls[s.imageAssetId]) && s.clips.every((c: any) => Boolean(urls[c.assetId])) && s.audio.every((a: any) => Boolean(urls[a.assetId])));
  return <section aria-label="Rough cut preview" className="min-w-0">
    <div className="relative mx-auto grid max-h-[52vh] w-full place-items-center overflow-hidden bg-black" style={{ aspectRatio: aspectRatio.replace(":", "/"), maxWidth: aspectRatio === "9:16" ? 320 : undefined }}>
      {clip && urls[clip.assetId] ? <video key={clip.assetId} ref={video} src={urls[clip.assetId]} playsInline muted={Boolean(scene?.audio.length)} preload="auto" onError={playbackError} className="h-full w-full object-contain" /> : scene && urls[scene.imageAssetId] ? <img src={urls[scene.imageAssetId]} alt={scene.title ?? "Scene preview"} className="h-full w-full object-contain" /> : <p className="p-6 text-sm text-zinc-400">Preview media is loading</p>}
      {track && urls[track.assetId] && <audio key={track.assetId} ref={audio} src={urls[track.assetId]} preload="auto" onError={playbackError} />}
    </div>
    <div className="mt-3 flex items-center gap-3">
      <button className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand text-white disabled:opacity-50" disabled={!ready || !total} title={playing ? "Pause preview" : "Play rough cut"} aria-label={playing ? "Pause preview" : "Play rough cut"} onClick={() => { setError(""); if (time >= total) setTime(0); setPlaying(!playing); }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-md" title="Restart preview" aria-label="Restart preview" onClick={() => setTime(0)}><RotateCcw size={17} /></button>
      <input aria-label="Preview position" type="range" className="min-w-0 flex-1" min={0} max={total || 1} step={0.1} value={time} onChange={event => setTime(Number(event.target.value))} />
      <span className="shrink-0 text-xs tabular-nums">{Math.floor(time)} / {Math.ceil(total)}s</span>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </section>;
}
