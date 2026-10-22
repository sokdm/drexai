import { useEffect, useRef, useState } from "react";
import { clipTransform, effectValues, EditorTimeline, timelineDuration, clipStart, trackStart } from "@drex/shared";

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
    const tick = (now: number) => { const media=video.current;const active=timeline.clips.find(c=>clock.current.time>=clipStart(timeline,c.id)&&clock.current.time<clipStart(timeline,c.id)+c.duration);
      const measured=active?.kind==='video'&&media ? media.ended?clipStart(timeline,active.id)+active.duration:media.readyState>=2&&!media.seeking?Math.min(clipStart(timeline,active.id)+active.duration,clipStart(timeline,active.id)+Math.max(0,media.currentTime-active.sourceIn)/(active.speed??1)):clock.current.time:clock.current.time+Math.max(0,(now-previous)/1000);
      const next = Math.min(clock.current.total,measured); previous = now; onTime(next); if (next >= clock.current.total) onPlaying(false); else frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, buffering, onTime, onPlaying, timeline]);
  useEffect(() => {
    const element = video.current;
    if (element && clip?.kind === "video") {
      element.playbackRate = clip.speed ?? 1;
      element.muted = clip.sourceAudio !== true || Boolean(clip.sourceMuted); element.volume = clip.sourceVolume ?? 1;
      const desired = clip.sourceIn + local * (clip.speed ?? 1);
      // Do not repeatedly seek the final encoded frame while the timeline holds
      // it to the requested boundary (recorded media can end between frames).
      if (!element.seeking && Math.abs(element.currentTime - desired) > 0.4 && (!Number.isFinite(element.duration) || desired < element.duration - .1)) element.currentTime = desired;
      if (playing) { if (element.paused) void element.play().catch(error => { if (error.name !== "AbortError") { onPlaying(false); onError("Video playback could not start. Refresh media links and try again."); } }); } else element.pause();
    }
    for (const a of timeline.audio) {
      const element = audio.current[a.id]; if (!element) continue;
      const position = time - trackStart(timeline, a), active = position >= 0 && position < a.duration;
      element.volume = a.muted ? 0 : Math.max(0, Math.min(1, a.volume * (a.fadeIn ? Math.min(1, position / a.fadeIn) : 1) * (a.fadeOut ? Math.min(1, (a.duration - position) / a.fadeOut) : 1)));
      if (active && Math.abs(element.currentTime - (a.sourceIn + position)) > 0.15) element.currentTime = a.sourceIn + position;
      if (playing && active && !buffering) { if (element.paused) void element.play().catch(error => { if (error.name !== "AbortError") { onPlaying(false); onError(`Audio playback unavailable: ${a.label}`); } }); } else element.pause();
    }
  }, [time, playing, clip?.id, url, timeline, buffering]);
  useEffect(() => { setBuffering(false); }, [clip?.id, url]);
  useEffect(() => {
    if(!buffering||!playing)return;
    const timer=window.setTimeout(()=>{setBuffering(false);onPlaying(false);onError('The video stream did not load. Retry playback or refresh media links. Your edits have not been changed.');},15000);
    return ()=>window.clearTimeout(timer);
  },[buffering,playing,clip?.id,url,onPlaying,onError]);
  const prior=clip?timeline.clips[timeline.clips.findIndex(c=>c.id===clip.id)-1]:undefined;
  const blend=prior?.transition==='dissolve'&&clip?Math.min(8/30,prior.duration/3,clip.duration/3):0;
  const motion = clipTransform(clip || {}, local);
  const fx = effectValues(clip || {});
  const fade = clip?.transition === "fade" ? Math.min(1, local / Math.min(0.3, clip.duration / 3), (clip.duration - local) / Math.min(0.3, clip.duration / 3)) : 1;
  function textStyle(style: any) { return { color: style.color, opacity: style.opacity, rotate: `${style.rotation || 0}deg`, ...(style.x !== undefined ? { left: `${style.x * 100}%`, right: "auto", width: "max-content", maxWidth: "95%", translate: "-50% 0" } : {}), fontFamily: style.font, fontSize: style.size / 720 * canvasHeight, top: style.y !== undefined ? `${style.y * 100}%` : style.position === "top" ? "8%" : style.position === "center" ? "50%" : undefined, bottom: style.y !== undefined ? undefined : style.position === "bottom" ? "8%" : undefined, transform: style.position === "center" ? "translateY(-50%)" : undefined, fontWeight: style.preset === "bold" ? 800 : 500, background: style.preset === "boxed" ? "#111111bb" : undefined }; }
  return <section ref={preview} className="editor-preview" aria-label="Rough cut preview"><div className="editor-screen" style={{ width: canvasWidth, height: canvasHeight }}><div className="editor-frame" style={{ opacity: Math.max(0, fade), filter: `brightness(${1 + fx.brightness}) contrast(${fx.contrast}) saturate(${fx.saturation})` }}>
    {clip?.kind === "video" && url ? <video key={`${clip.id}-${url}`} ref={video} src={url} playsInline muted={clip.sourceAudio !== true || Boolean(clip.sourceMuted)} preload="auto" style={{ transform: `scale(${motion.zoom})`, transformOrigin: `${motion.x * 100}% ${motion.y * 100}%`, objectFit: clip.fit, objectPosition: `${(clip.cropX ?? 0.5) * 100}% 50%` }} onLoadStart={() => setBuffering(true)} onEnded={() => setBuffering(false)} onSeeked={() => setBuffering(false)} onWaiting={e => { const v = e.currentTarget; if (!v.ended && (!Number.isFinite(v.duration) || v.currentTime < v.duration - .25)) setBuffering(true); }} onPlaying={() => setBuffering(false)} onLoadedData={() => setBuffering(false)} onCanPlay={() => setBuffering(false)} onLoadedMetadata={() => { if (video.current) video.current.currentTime = clip.sourceIn + local * (clip.speed ?? 1); }} onError={() => { setBuffering(false); onPlaying(false); onError("Video unavailable. Refresh media links."); }} /> : clip?.kind === "image" && url ? <img src={url} alt={clip.label} style={{ transform: `scale(${motion.zoom})`, transformOrigin: `${motion.x * 100}% ${motion.y * 100}%`, objectFit: clip.fit, objectPosition: `${(clip.cropX ?? 0.5) * 100}% 50%` }} /> : clip?.kind !== "title" ? <span className="editor-screen-note">{clip ? "Loading media…" : "Add media to your timeline"}</span> : null}
    {prior&&blend>0&&local<blend&&<div aria-label="Dissolve join" style={{position:'absolute',inset:0,opacity:1-local/blend,pointerEvents:'none',background:'#111827'}}>{prior.kind==='video'&&prior.assetId&&urls[prior.assetId]?<video src={urls[prior.assetId]} muted playsInline preload="auto" style={{width:'100%',height:'100%',objectFit:prior.fit}} onLoadedMetadata={e=>{e.currentTarget.currentTime=Math.min(e.currentTarget.duration-.04,prior.sourceIn+prior.duration*(prior.speed??1)-.04);}}/>:prior.kind==='image'&&prior.assetId?<img src={urls[prior.assetId]} alt="" style={{width:'100%',height:'100%',objectFit:prior.fit}}/>:prior.text?<div className="editor-overlay" style={textStyle(prior.textStyle)}>{prior.text}</div>:null}</div>}
    {clip?.text && <div className="editor-overlay" style={textStyle(clip.textStyle)}>{clip.text}</div>}</div>
    {(timeline.overlays || []).filter(o => time >= o.start && time < o.start + o.duration).map(o => <MediaOverlay key={o.id} overlay={o} url={urls[o.assetId]} time={time} playing={playing && !buffering} onError={onError} />)}
    {timeline.captions.filter(c => time >= trackStart(timeline, c) && time < trackStart(timeline, c) + c.end - c.start).map(c => <div key={c.id} className={`editor-overlay caption-${c.style.animation || "none"}`} style={textStyle(c.style)}>{c.text}</div>)}{buffering && playing && <span className="editor-buffer">Buffering…</span>}</div>
    {timeline.audio.map(a => urls[a.assetId] && <audio key={`${a.id}-${urls[a.assetId]}`} ref={element => { audio.current[a.id] = element; }} src={urls[a.assetId]} preload="auto" onError={() => { onPlaying(false); onError(`Audio unavailable: ${a.label}`); }} />)}</section>;
}
function MediaOverlay({ overlay: o, url, time, playing, onError }: any) {
 const ref = useRef<HTMLVideoElement>(null), local = Math.max(0,time-o.start);
 useEffect(() => { const v = ref.current;if (!v) return; const desired = o.sourceIn + local;if (Math.abs(v.currentTime-desired)>.15) v.currentTime=desired;if (playing) void v.play().catch((e: any) => { if (e.name !== "AbortError") onError("Overlay playback could not start"); });else v.pause(); }, [time,playing,url]);
 const progress = Math.min(1,local/.3), zoom = o.animation === "zoom-in" ? .7+.3*progress : 1;
 const opacity = o.animation === "fade" ? Math.min(1,local/Math.min(.3,o.duration/2),(o.duration-local)/Math.min(.3,o.duration/2)) : 1;
 return <div aria-label={`Overlay: ${o.label}`} style={{ position:"absolute",zIndex:2,left:`${o.x*100-(o.animation === "slide-left" ? (1-progress)*100 : 0)}%`,top:`${o.y*100}%`,width:`${o.width*100}%`,height:`${o.height*100}%`,opacity:o.opacity*Math.max(0,opacity),transform:`translate(-50%,-50%) rotate(${o.rotation}deg) scale(${zoom})`,pointerEvents:"none" }}>{o.kind === "video" ? <video ref={ref} src={url} muted playsInline preload="auto" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={() => onError("Overlay media unavailable")} /> : <img src={url} alt={o.label} style={{width:"100%",height:"100%",objectFit:"contain"}} />}</div>;
}
