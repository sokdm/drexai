import { useEffect, useRef, useState } from "react";
import { effectValues, EditorTimeline, timelineDuration, clipStart, trackStart } from "@drex/shared";

export function EditorPlayer({ timeline, urls, time, playing, onTime, onPlaying, onError }: { timeline: EditorTimeline; urls: Record<string, string>; time: number; playing: boolean; onTime: (time: number) => void; onPlaying: (playing: boolean) => void; onError: (message: string) => void }) {
  const total = timelineDuration(timeline), video = useRef<HTMLVideoElement>(null), audio = useRef<Record<string, HTMLAudioElement | null>>({});
  const clock = useRef({ time, total }); clock.current = { time, total };
  const [buffering, setBuffering] = useState(false);
  const preview = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ width: 640, height: 340 });
  const ratio = timeline.aspectRatio === "16:9" ? 16 / 9 : timeline.aspectRatio === "9:16" ? 9 / 16 : 1;
  const canvasWidth = Math.min(bounds.width, bounds.height * ratio), canvasHeight = canvasWidth / ratio;
  useEffect(() => {
    const element = preview.current; if (!element) return;
    const measure = () => { const width = element.clientWidth, height = element.clientHeight; setBounds(old => old.width === width && old.height === height ? old : { width, height }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const clip = timeline.clips.find(c => time >= clipStart(timeline, c.id) && time < clipStart(timeline, c.id) + c.duration) ?? timeline.clips[timeline.clips.length - 1];
  const local = clip ? Math.max(0, time - clipStart(timeline, clip.id)) : 0, url = clip?.assetId ? urls[clip.assetId] : undefined;
  useEffect(() => {
    if (!playing || buffering) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => { const next = Math.min(clock.current.total, clock.current.time + Math.min((now - previous) / 1000, 0.1)); previous = now; onTime(next); if (next >= clock.current.total) onPlaying(false); else frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, buffering, onTime, onPlaying]);
  useEffect(() => {
    const element = video.current;
    if (element && clip?.kind === "video") {
      element.muted = clip.sourceAudio !== true || Boolean(clip.sourceMuted); element.volume = clip.sourceVolume ?? 1;
      if (Math.abs(element.currentTime - clip.sourceIn - local) > 0.15) element.currentTime = clip.sourceIn + local;
      if (playing) { if (!buffering && element.paused) void element.play().catch(error => { if (error.name !== "AbortError") { onPlaying(false); onError("Video playback could not start. Refresh media links and try again."); } }); } else element.pause();
    }
    for (const a of timeline.audio) {
      const element = audio.current[a.id]; if (!element) continue;
      const position = time - trackStart(timeline, a), active = position >= 0 && position < a.duration;
      element.volume = a.muted ? 0 : Math.max(0, Math.min(1, a.volume * (a.fadeIn ? Math.min(1, position / a.fadeIn) : 1) * (a.fadeOut ? Math.min(1, (a.duration - position) / a.fadeOut) : 1)));
      if (active && Math.abs(element.currentTime - (a.sourceIn + position)) > 0.15) element.currentTime = a.sourceIn + position;
      if (playing && active && !buffering) { if (element.paused) void element.play().catch(error => { if (error.name !== "AbortError") { onPlaying(false); onError(`Audio playback unavailable: ${a.label}`); } }); } else element.pause();
    }
  }, [time, playing, clip?.id, url, timeline, buffering]);
  useEffect(() => { setBuffering(false); }, [clip?.id]);
  const fx = effectValues(clip || {});
  const fade = clip?.transition === "fade" ? Math.min(1, local / Math.min(0.3, clip.duration / 3), (clip.duration - local) / Math.min(0.3, clip.duration / 3)) : 1;
  function textStyle(style: any) { return { fontFamily: style.font, fontSize: style.size / 720 * canvasHeight, top: style.position === "top" ? "8%" : style.position === "center" ? "50%" : undefined, bottom: style.position === "bottom" ? "8%" : undefined, transform: style.position === "center" ? "translateY(-50%)" : undefined, fontWeight: style.preset === "bold" ? 800 : 500, background: style.preset === "boxed" ? "#111111bb" : undefined }; }
  return <section ref={preview} className="editor-preview" aria-label="Rough cut preview"><div className="editor-screen" style={{ width: canvasWidth, height: canvasHeight }}><div className="editor-frame" style={{ opacity: Math.max(0, fade), filter: `brightness(${1 + fx.brightness}) contrast(${fx.contrast}) saturate(${fx.saturation})` }}>
    {clip?.kind === "video" && url ? <video key={`${clip.id}-${url}`} ref={video} src={url} playsInline muted={clip.sourceAudio !== true || Boolean(clip.sourceMuted)} preload="auto" style={{ objectFit: clip.fit, objectPosition: `${(clip.cropX ?? 0.5) * 100}% 50%` }} onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onLoadedMetadata={() => { if (video.current) video.current.currentTime = clip.sourceIn + local; }} onError={() => { onPlaying(false); onError("Video unavailable. Refresh media links."); }} /> : clip?.kind === "image" && url ? <img src={url} alt={clip.label} style={{ objectFit: clip.fit, objectPosition: `${(clip.cropX ?? 0.5) * 100}% 50%` }} /> : clip?.kind !== "title" ? <span className="editor-screen-note">{clip ? "Loading media…" : "Add media to your timeline"}</span> : null}
    {clip?.text && <div className="editor-overlay" style={textStyle(clip.textStyle)}>{clip.text}</div>}</div>
    {timeline.captions.filter(c => time >= trackStart(timeline, c) && time < trackStart(timeline, c) + c.end - c.start).map(c => <div key={c.id} className={`editor-overlay caption-${c.style.animation || "none"}`} style={textStyle(c.style)}>{c.text}</div>)}{buffering && playing && <span className="editor-buffer">Buffering…</span>}</div>
    {timeline.audio.map(a => urls[a.assetId] && <audio key={`${a.id}-${urls[a.assetId]}`} ref={element => { audio.current[a.id] = element; }} src={urls[a.assetId]} preload="auto" onError={() => { onPlaying(false); onError(`Audio unavailable: ${a.label}`); }} />)}</section>;
}
