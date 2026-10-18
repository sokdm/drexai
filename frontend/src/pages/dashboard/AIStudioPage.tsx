import {timelineSchema} from "@drex/shared";
import { StudioBrief } from "./StudioBrief";
import { StudioStoryboard } from "./StudioStoryboard";
import { appendLibraryAsset } from "../../lib/appendLibraryAsset";
import { AssetPacks } from "../../components/AssetPacks";
import { ProductCommercial } from "./ProductCommercial";
import { AIAssistantPage } from "./AIAssistantPage";
import { downloadMedia } from "../../lib/downloadMedia";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ShoppingBag, MessageSquare, Scissors, ChevronLeft, ChevronRight, Clapperboard, Download, Eye, PanelLeftClose, PanelRightClose, Pause, Play, RefreshCw, Square, Terminal } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { api, API_URL } from "../../lib/api";
import { EditorPlayer } from "./EditorPlayer";
import { StudioPreview } from "./StudioPreview";

const fieldClass = "focus-ring mt-1 h-10 w-full rounded-md border border-line bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const defaults = { autoExport:true, imageModel: "gemini-nano-banana-2.1", videoModel: "veo-3.1-generate-preview", voiceModel: "gemini-3.8-flash-tts", aspectRatio: "16:9", resolution: "1K", quality: "720p", voiceId: "Kore", language: "English", style: "cinematic", narration: true, video: true, targetSeconds: 60, maxClipsPerScene: 3, characterVoices: {} as Record<string, string> };
const eventColors: Record<string, string> = { waiting: "text-amber-400", processing: "text-sky-400", success: "text-emerald-400", failure: "text-red-400", cancelled: "text-zinc-400" };

export function AIStudioPage() {
  const [briefActivity,setBriefActivity]=useState<any[]>([]);
  const [budget,setBudget]=useState<any>(null);
  const [exports,setExports]=useState<any[]>([]);
  const [sharedEdit, setSharedEdit] = useState<any>(null), [editTime, setEditTime] = useState(0), [editPlaying, setEditPlaying] = useState(false);
  const [studioMode, setStudioMode] = useState(new URLSearchParams(window.location.search).get("mode") === "commercial" ? "commercial" : "production");
  const [params, setParams] = useSearchParams();
  const [config, setConfig] = useState<any>(null);
  const [projectId, setProjectId] = useState(params.get("projectId") ?? "");
  const [production, setProduction] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState(defaults);
  const [sceneId, setSceneId] = useState("");
  const [maxCredits, setMaxCredits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [preview, setPreview] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState("");
  const [connected, setConnected] = useState(false);
  const productionId = params.get("productionId");
  const activeRequest = useRef(0);
  const activityFeed = useRef<HTMLDivElement>(null);
  useEffect(() => { const node = activityFeed.current; if (node) node.scrollTop = node.scrollHeight; }, [events.length]);
  const refresh = useCallback(async () => {
    if (!productionId) return;
    const data = await api<any>(`/api/studio/productions/${productionId}`);
    setProduction(data.production); setAssets(data.assets); setEvents(data.events);setExports(data.exports||[]);setBudget(data.budget);
    if (data.production.timeline?.length || data.production.snapshot?.manual) { const saved = await api<any>(`/api/studio/productions/${productionId}/edit`); setSharedEdit({...saved.edit,timeline:timelineSchema.parse(saved.edit.timeline)}); if (saved.assets) setAssets(old => [...old, ...saved.assets.filter((a: any) => !old.some(o => o._id === a._id))]); }
  }, [productionId]);

  useEffect(() => {
    let alive = true;
    api<any>("/api/studio/config").then(data => { if (alive) { setConfig(data); setProjectId(value => value || data.projects[0]?._id || ""); if (!productionId && data.imageModels?.[0] && data.videoModels?.[0] && data.voiceModels?.[0]) setSettings(old => ({ ...old,imageModel:data.imageModels[0].id,resolution:data.imageModels[0].resolutions[0],videoModel:data.videoModels[0].id,quality:data.videoModels[0].qualities[0],voiceModel:data.voiceModels[0].id,voiceId:data.voiceModels[0].voices[0],language:data.voiceModels[0].languages[0] })); } }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api<any>(`/api/studio/productions?projectId=${projectId}`).then(data => { if (alive) setHistory(data.productions); }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [projectId, production?.status, productionId]);
  useEffect(() => {
    setProduction(null); setSharedEdit(null);setBudget(null);setExports([]); setAssets([]); setEvents([]); setUrls({}); setPreview(false);
    if (!productionId) return;
    let alive = true;
    const serial = ++activeRequest.current;
    let initial = true;
    const load = async () => {
      try {
        const data = await api<any>(`/api/studio/productions/${productionId}`);
        if (!alive || serial !== activeRequest.current) return;
        setProduction(data.production); setAssets(data.assets); setEvents(data.events);
        if (data.production.timeline?.length || data.production.snapshot?.manual) { const saved = await api<any>(`/api/studio/productions/${productionId}/edit`); if (!alive) return; setSharedEdit({...saved.edit,timeline:timelineSchema.parse(saved.edit.timeline)}); if (saved.assets) setAssets(old => [...old, ...saved.assets.filter((a: any) => !old.some(o => o._id === a._id))]); }
        setProjectId(String(data.production.projectId));
        if (initial) {
          setMaxCredits(data.production.maxCredits || data.production.estimate.credits || 0);
          setSettings({ ...defaults, ...data.production.settings,autoExport:Boolean(data.production.settings?.autoExport) });
          initial = false;
        }
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : "Could not load production"); }
    };
    void load();
    const stream = new EventSource(`${API_URL}/api/studio/productions/${productionId}/events`, { withCredentials: true });
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener("activity", () => { void load(); });
    const poll = setInterval(() => { void load(); }, 12000);
    return () => { alive = false; activeRequest.current++; stream.close(); clearInterval(poll); setConnected(false); };
  }, [productionId]);
  useEffect(() => {
    let alive = true;
    const missing = assets.filter(asset => !urls[asset._id]);
    if (missing.length) Promise.all(missing.map(async asset => {
      const data = await api<{ url: string }>(`/api/studio/assets/${asset._id}/url`);
      return [asset._id, data.url] as const;
    })).then(entries => { if (alive) setUrls(previous => ({ ...previous, ...Object.fromEntries(entries) })); }).catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [assets, urls]);
  useEffect(() => { const timer = setInterval(() => setUrls({}), 45 * 60000); return () => clearInterval(timer); }, [productionId]);

  const project = config?.projects.find((item: any) => item._id === projectId);
  useEffect(() => { if (!productionId && project?.prompts?.sourceSettings?.product) { const seconds = Number(String(project.targetDuration).match(/[\d.]+/)?.[0]);if (Number.isFinite(seconds) && seconds >= 4) setSettings(old => ({ ...old,targetSeconds:Math.min(3600, /second/i.test(project.targetDuration) ? seconds : seconds * 60) })); } }, [project?._id,productionId]);
  const scenes = production?.snapshot.scenes ?? project?.scenes ?? [];
  const sortedScenes = [...scenes].sort((a, b) => a.order - b.order);
  const scene = sortedScenes.find((s: any) => String(s._id) === sceneId) ?? sortedScenes[0];
  const steps = production?.steps ?? [];
  const sceneSteps = steps.filter((s: any) => s.sceneId === String(scene?._id));
  const sceneAssets = assets.filter(asset => sceneSteps.some((step: any) => step.assetId === asset._id));
  const previewAsset = sceneAssets.find(asset => asset._id === previewAssetId) ?? sceneAssets.find(asset => asset.type === "video") ?? sceneAssets.find(asset => asset.type === "image");
  const finished = steps.filter((s: any) => ["completed", "skipped"].includes(s.status)).length;
  const spent = budget?.settled ?? steps.filter((s: any) => s.charged).reduce((sum: number, s: any) => sum + s.credits, 0);
  const ready = config?.readiness && Object.values(config.readiness).every(Boolean);
  const running = ["queued", "running"].includes(production?.status);
  const current = steps.find((s: any) => s.status === "requesting");
  const imageModel = config?.imageModels.find((m: any) => m.id === settings.imageModel);
  const voiceModel = config?.voiceModels.find((m: any) => m.id === settings.voiceModel);
  const characters = production?.snapshot.characters ?? config?.characters.filter((c: any) => String(c.projectId) === projectId) ?? [];
  useEffect(() => {
    if (productionId || !project) return;
    const duration = String(project.targetDuration ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)$/i);
    const seconds = duration ? Number(duration[1]) * (/^m/i.test(duration[2]) ? 60 : 1) : 60;
    setSettings(previous => ({ ...previous, targetSeconds: Math.max(4, Math.min(3600, Math.round(seconds))), language: project.language || "English" }));
  }, [projectId, config, productionId]);

  async function act(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Production action failed"); }
    finally { setBusy(false); }
  }
  async function reviewAudio(asset: any, status: "accepted" | "issue") {
    const note = window.prompt(status === "issue" ? "Describe the dialogue, voice or mouth synchronization issue" : "Review note (optional)", "");
    if (note === null) return;
    const transcript = status === "accepted" ? window.prompt("After listening, enter the actual spoken words for captions (optional). Do not copy unverified script text.", "") : null;
    await act(async () => { const result = await api<any>(`/api/studio/assets/${asset._id}/audio-review`, { method: "POST", body: JSON.stringify({ status, note, ...(transcript ? { transcript } : {}) }) }); setAssets(old => old.map(a => a._id === asset._id ? result.asset : a)); });
  }
  async function plan(regenerateStepKey?: string) {
    const data = await api<any>("/api/studio/plans", { method: "POST", body: JSON.stringify({ projectId, settings, ...(regenerateStepKey ? { sourceProductionId: production._id, regenerateStepKey } : {}) }) });
    setMaxCredits(data.production.estimate.credits ?? 0);
    setParams({ projectId, productionId: data.production._id });
  }
  async function control(action: string) {
    await api(`/api/studio/productions/${productionId}/control`, { method: "POST", body: JSON.stringify({ action }) }); await refresh();
  }
  function chooseProject(value: string) { setProjectId(value); setParams({ projectId: value }); setSceneId(""); setMaxCredits(0); }
  function downloadTimeline() {
    const blob = new Blob([JSON.stringify({ title: production.title, settings: production.settings, timeline: production.timeline }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "drex-production-timeline.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={`studio-workspace space-y-4 ${studioMode === "agent" ? "studio-agent-focus" : ""}`}><nav className="creator-mode-tabs" aria-label="Studio tools"><button aria-pressed={studioMode === "production"} onClick={() => setStudioMode("production")}><Clapperboard size={13}/>Video production</button>{(production?.timeline?.length > 0 || sharedEdit) && <Link to={`/dashboard/video-editor?productionId=${productionId}`}>Timeline and export</Link>}<button aria-pressed={studioMode === "commercial"} onClick={() => setStudioMode("commercial")}><ShoppingBag size={13}/>Product Commercials</button><button aria-pressed={studioMode === "agent"} onClick={() => {setStudioMode("agent");setRightOpen(true);}}><MessageSquare size={13}/>AI Director chat</button><Link to="/dashboard/video-editor?mode=shorts"><Scissors size={13}/>Long video to short clips</Link></nav>{studioMode === "commercial" && <ProductCommercial onReady={p => { setConfig((old: any) => old ? { ...old, projects: [p, ...old.projects.filter((item: any) => item._id !== p._id)] } : old); setProjectId(p._id);setParams({projectId:p._id});setStudioMode("production"); }} />}<div hidden={studioMode === "commercial"}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4 dark:border-slate-800">
      <div><h1 className="text-2xl font-bold">AI Studio</h1><p className="mt-1 text-sm text-slate-500">{production?.title ?? project?.title ?? "Choose a script project"}</p></div>
      <div className="flex items-center gap-2"><span className="text-xs text-slate-500">{production?.status?.replaceAll("_", " ") ?? "Ready to plan"}</span><button aria-label="Toggle project panel" title="Project panel" className="focus-ring grid h-10 w-10 place-items-center rounded-md border border-line dark:border-slate-700" onClick={() => setLeftOpen(!leftOpen)}><PanelLeftClose size={18} /></button><button aria-label="Toggle activity panel" title="Activity panel" className="focus-ring grid h-10 w-10 place-items-center rounded-md border border-line dark:border-slate-700" onClick={() => setRightOpen(!rightOpen)}><PanelRightClose size={18} /></button></div>
    </header>
    {error && <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</div>}
    {config && !ready && <div role="status" className="studio-setup-notice border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Production setup pending: {[
      !config.readiness.queueEnabled && "Redis queue", !config.readiness.storageConfigured && "R2 storage", !config.readiness.providerConfigured && "AI provider key", !config.readiness.workerOnline && "Studio worker"
    ].filter(Boolean).join(", ")}.</div>}
    <div className={`studio-columns ${leftOpen ? "studio-with-left" : ""} ${rightOpen ? "studio-with-right" : ""}`}>
      {leftOpen && <aside className="studio-project space-y-5 border-b border-line pb-4 dark:border-slate-800"><h2 className="reference-panel-title"><Clapperboard size={15}/>Project setup</h2><details open={!projectId}><summary>Create a new video</summary><StudioBrief onActivity={setBriefActivity} onProject={value => { setConfig((old:any)=>old?{...old,projects:[value,...old.projects.filter((p:any)=>p._id!==value._id)]}:old);chooseProject(value._id); }}/></details>
        <label className="block text-xs font-semibold">Project<select className={fieldClass} value={projectId} onChange={e => chooseProject(e.target.value)}><option value="">Select a project</option>{config?.projects.map((p: any) => <option key={p._id} value={p._id}>{p.title}{!p.approvedAt ? " (draft)" : ""}</option>)}</select></label>
        {production?.snapshot.niche && <p className="text-sm font-semibold text-teal-700 dark:text-teal-300">{production.snapshot.niche.name}</p>}
        <p className="text-sm leading-6 text-slate-500">{production?.snapshot.summary ?? project?.summary}</p>
        {history.length > 0 && <label className="block text-xs font-semibold">Production history<select className={fieldClass} value={productionId ?? ""} onChange={e => setParams(e.target.value ? { projectId, productionId: e.target.value } : { projectId })}><option value="">New plan</option>{history.map(item => <option value={item._id} key={item._id}>{new Date(item.createdAt).toLocaleString()} / {item.status}</option>)}</select></label>}
        <nav aria-label="Production scenes" className="max-h-60 space-y-1 overflow-auto">{sortedScenes.map((s: any) => <button key={s._id} className={`focus-ring flex w-full items-start gap-2 rounded-md p-2 text-left text-sm ${s._id === scene?._id ? "bg-brand/10 font-semibold text-brand dark:text-brand-dark" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`} onClick={() => { setSceneId(s._id); setPreview(false); }}><span className="w-6 shrink-0 tabular-nums">{s.order}.</span><span className="min-w-0 break-words">{s.title || "Untitled scene"}</span></button>)}</nav>
        <Button className="w-full" disabled={busy || !project?.approvedAt || running} onClick={() => act(() => plan())}><Clapperboard size={17} />Prepare estimate</Button>
        {project && !project.approvedAt && <button disabled={busy || !project.scenes?.length} onClick={()=>void act(async()=>{await api(`/api/ai/projects/${projectId}/approve`,{method:"POST",body:"{}"});const data=await api<any>(`/api/ai/projects/${projectId}`);setConfig((old:any)=>({...old,projects:old.projects.map((p:any)=>p._id===projectId?data.project:p)}));})}>Approve reviewed scenes</button>}{project && <Link className="block text-xs" to={`/dashboard/script-builder?projectId=${projectId}`}>Optional detailed script editing</Link>}
        <details><summary className="cursor-pointer text-sm font-bold">Production settings</summary><div className="mt-3 grid gap-3">
          <Select label="Image model" value={settings.imageModel} options={config?.imageModels.map((m: any) => m.id) ?? []} onChange={v => setSettings({ ...settings, imageModel: v, resolution: config.imageModels.find((m: any) => m.id === v).resolutions[0] })} />
          <Select label="Image resolution" value={settings.resolution} options={imageModel?.resolutions ?? []} onChange={v => setSettings({ ...settings, resolution: v })} />
          <Select label="Aspect ratio" value={settings.aspectRatio} options={["16:9", "9:16"]} onChange={v => setSettings({ ...settings, aspectRatio: v })} />
          <Select label="Video model" value={settings.videoModel} options={config?.videoModels.map((m: any) => m.id) ?? []} onChange={v => setSettings({ ...settings, videoModel: v })} />
          <Select label="Video quality" value={settings.quality} options={config?.videoModels.find((m: any) => m.id === settings.videoModel)?.qualities ?? []} onChange={v => setSettings({ ...settings, quality: v })} />
          <Select label="Voice model" value={settings.voiceModel} options={config?.voiceModels.map((m: any) => m.id) ?? []} onChange={v => { const model = config.voiceModels.find((m: any) => m.id === v); setSettings({ ...settings, voiceModel: v, voiceId: model.voices[0], language: model.languages[0], characterVoices: {} }); }} />
          <Select label="Narrator voice" value={settings.voiceId} options={voiceModel?.voices ?? []} onChange={v => setSettings({ ...settings, voiceId: v })} />
          <Select label="Language" value={settings.language} options={voiceModel?.languages ?? []} onChange={v => setSettings({ ...settings, language: v })} />
          <label className="text-xs font-semibold">Target seconds<input type="number" min={4} max={3600} className={fieldClass} value={settings.targetSeconds} onChange={e => setSettings({ ...settings, targetSeconds: Number(e.target.value) })} /></label>
          <label className="text-xs font-semibold">Maximum clips per scene<input type="number" min={1} max={12} className={fieldClass} value={settings.maxClipsPerScene} onChange={e => setSettings({ ...settings, maxClipsPerScene: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.narration} onChange={e => setSettings({ ...settings, narration: e.target.checked })} />Generate off-screen narration</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.autoExport} onChange={e=>setSettings({...settings,autoExport:e.target.checked})}/>Render MP4 within the production budget</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.video} onChange={e => setSettings({ ...settings, video: e.target.checked })} />Generate video clips</label>
          <p className="text-xs text-slate-500">Supported native dialogue and environmental sound are generated with the video. Narrator voice settings apply only to separate TTS narration. Accent and delivery directions come from each script scene.</p>
        </div></details><details><summary>Assets and licensed packs</summary><AssetPacks edit={sharedEdit} disabled={busy} onUse={async asset => { if (!sharedEdit) throw new Error("Complete a rough cut first"); const timeline = appendLibraryAsset(sharedEdit.timeline,asset);const result = await api<any>(`/api/editor/edits/${sharedEdit._id}`, { method:"PUT",body:JSON.stringify({ title:sharedEdit.title,revision:sharedEdit.revision,timeline }) });setSharedEdit(result.edit);await refresh(); }} onAsset={a => setAssets(old => [a,...old])} onEdit={value => { setSharedEdit(value);void refresh(); }} /></details><section className="studio-asset-library"><h3>Production assets</h3>{assets.filter(a => a.type !== "audio").map(asset => <button key={asset._id} onClick={() => { const step = steps.find((s: any) => s.assetId === asset._id); if (step?.sceneId) setSceneId(step.sceneId); setPreviewAssetId(asset._id); setPreview(false); }}>{urls[asset._id] && (asset.type === "video" ? <video src={urls[asset._id]} muted preload="metadata" /> : <img src={urls[asset._id]} alt="Scene asset" />)}<span>{asset.type}</span></button>)}</section>
      </aside>}
      <main className="studio-center min-w-0 space-y-5"><div className="reference-project-heading"><div><h2>{production?.title || project?.title || "Your video production"}</h2><p>{production?.snapshot.summary || project?.summary || "Plan, create and edit your next production."}</p></div><span>{project?.type || "Video production"}</span></div>
        {production?.status === "completed" && <div role="status" className="border-l-2 border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Your production timeline is ready. MP4 rendering progress appears in the conversation. Review native dialogue and voice synchronization.</div>}
        {production?.status === "draft" && !production?.snapshot?.manual && <section aria-label="Production quote" className="border-y border-line py-4 dark:border-slate-800">
          <h2 className="text-lg font-bold">Production estimate</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Images", production.estimate.images], ["Speech segments", production.estimate.audioSegments], ["Max clips", production.estimate.maxClips], ["Max video seconds", production.estimate.maxVideoSeconds]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold">{value}</dd></div>)}</dl>
          <p className="mt-3 text-sm text-slate-500">{production.estimate.coverage}</p>
          {production.estimate.missingPricing.length > 0 ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Pricing unavailable: {production.estimate.missingPricing.join(", ")}</p> : <p className="mt-4 text-lg font-bold">{production.estimate.credits} credits maximum estimated</p>}
          <label className="mt-3 block max-w-xs text-sm font-semibold">Approved spending limit<input className={fieldClass} type="number" min={production.estimate.credits ?? 0} max={1000000} value={maxCredits} onChange={e => setMaxCredits(Number(e.target.value))} /></label>
          <p className="mt-2 text-xs text-slate-500">Quote expires {new Date(production.expiresAt).toLocaleTimeString()}. {production.settings.autoExport ? `MP4 rendering included: ${production.estimate.renderCredits || 0} credits.` : "Rough-cut preview adds no rendering charge."}</p>
          <div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy || !ready || production.estimate.credits == null || maxCredits < production.estimate.credits} onClick={() => act(async () => { await api(`/api/studio/productions/${productionId}/approve`, { method: "POST", body: JSON.stringify({ maxCredits }) }); await refresh(); })}><Play size={17} />Approve & start</Button><Button variant="secondary" disabled={busy} onClick={() => act(() => control("cancel"))}>Cancel plan</Button></div>
        </section>}
        {sharedEdit && (preview || production?.snapshot?.manual) ? <div><EditorPlayer timeline={sharedEdit.timeline} urls={urls} time={editTime} playing={editPlaying} onTime={setEditTime} onPlaying={setEditPlaying} onError={setError} /><button aria-label={editPlaying ? "Pause preview" : "Play rough cut"} onClick={() => setEditPlaying(v => !v)}>{editPlaying ? "Pause" : "Play shared edit"}</button><input type="range" aria-label="Preview position" min={0} max={sharedEdit.timeline.clips.reduce((n: number, c: any) => n + c.duration, 0)} step={0.05} value={editTime} onChange={e => { setEditTime(Number(e.target.value)); setEditPlaying(false); }} /><Link to={`/dashboard/video-editor?editId=${sharedEdit._id}`}>Open this timeline in Video Editor</Link><p>Revision {sharedEdit.revision}. Saved manual edits are preserved.</p></div> : <section>
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{scene ? `Scene ${scene.order}: ${scene.title}` : "Scene preview"}</h2><span className="text-xs text-slate-500">{scene?.approved ? "Approved" : ""}</span></div>
          <div className="mt-3 grid min-h-52 place-items-center bg-zinc-950" style={{ aspectRatio: "16/9" }}>{previewAsset && urls[previewAsset._id] ? previewAsset.type === "video" ? <video key={previewAsset._id} controls playsInline className="max-h-[52vh] w-full" src={urls[previewAsset._id]} /> : <img className="max-h-[52vh] w-full object-contain" alt={scene?.title ?? "Scene output"} src={urls[previewAsset._id]} /> : <div className="p-6 text-center text-zinc-400"><Clapperboard size={30} className="mx-auto mb-3" /><p className="text-sm">{production ? "Waiting for scene outputs" : "No production selected"}</p></div>}</div>
          {scene && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Scene prompts and speech</summary><div className="mt-3 space-y-3 text-sm text-slate-500">{[["Image", scene.imagePrompt], ["Motion", scene.videoMotionPrompt], ["Narration", scene.narration], ["Dialogue", scene.dialogue]].map(([label, value]) => value && <p className="whitespace-pre-wrap" key={label}><strong>{label}: </strong>{value}</p>)}</div></details>}
          {sceneAssets.filter((asset: any) => asset.type === "video" && asset.metadata?.nativeAudio).map((asset: any) => <div key={asset._id} className="mt-3 rounded-md border border-line p-3 text-sm dark:border-slate-700"><p>Native soundtrack detected. Dialogue and lip-sync: {asset.metadata?.audioReview?.status || "needs review"}.</p><p className="mt-1 text-xs text-slate-500">Listen and check intended words, speakers, mouth movements and voice consistency. Automatic track detection does not verify speech.</p><div className="mt-2 flex flex-wrap gap-3"><button disabled={busy} onClick={() => void reviewAudio(asset, "accepted")}>Mark reviewed and add transcript</button><button disabled={busy} onClick={() => void reviewAudio(asset, "issue")}>Report audio issue</button></div></div>)}
          <div className="mt-4 space-y-2">{sceneSteps.map((step: any) => <div key={step.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm dark:border-slate-800"><div className="min-w-0"><p>{step.label}</p><span className="text-xs text-slate-500">{step.status.replaceAll("_", " ")} / {step.credits} credits</span></div><div className="flex gap-1">{step.assetId && step.kind !== "audio" && <button title="Preview output" aria-label={`Preview ${step.label}`} className="focus-ring grid h-9 w-9 place-items-center rounded-md" onClick={() => { setPreviewAssetId(step.assetId); setPreview(false); }}><Eye size={16} /></button>}{step.assetId && urls[step.assetId] && <a title="Download output" aria-label="Download output" href={urls[step.assetId]} target="_blank" rel="noreferrer" download className="focus-ring grid h-9 w-9 place-items-center rounded-md"><Download size={16} /></a>}{production && ["completed", "cancelled", "failed", "needs_review", "paused"].includes(production.status) && <button disabled={busy} title="Get regeneration quote" aria-label={`Regenerate ${step.label}`} className="focus-ring grid h-9 w-9 place-items-center rounded-md" onClick={() => act(() => plan(step.key))}><RefreshCw size={16} /></button>}</div>{step.error && <p className="w-full text-xs text-red-500">{step.error}</p>}{step.kind === "audio" && step.assetId && urls[step.assetId] && <audio controls className="w-full" src={urls[step.assetId]} />}</div>)}</div>
        </section>}
        {production && <div className="border-t border-line pt-4 dark:border-slate-800"><div className="flex justify-between gap-2 text-xs text-slate-500"><span>{finished} / {steps.length} steps</span><span>{spent} / {production.maxCredits || production.estimate.credits || 0} credits settled</span></div><progress aria-label="Production progress" value={finished} max={steps.length || 1} className="mt-2 h-2 w-full accent-emerald-500" /></div>}
        <StudioStoryboard scenes={sortedScenes} steps={steps} assets={assets} urls={urls} selectedId={scene?._id} onScene={(id: string) => { setSceneId(id);setPreview(false); }} edit={sharedEdit} time={editTime} onSeek={(value: number)=>{setPreview(true);setEditTime(value);setEditPlaying(false);}} />
      </main>
      {rightOpen && <aside className="studio-activity min-w-0"><section className="studio-director-panel"><h2>AI Production Assistant</h2><AIAssistantPage productionId={productionId || undefined} projectId={projectId || undefined} productionSettings={settings} activity={events} onProductionPlan={p=>{setMaxCredits(p.estimate.credits??0);setParams({projectId:String(p.projectId),productionId:p._id});}} budgetApproval={<>{exports.map(job=><div key={job._id} className="agent-tool-activity"><p>MP4 export ? {job.status} ? {job.progress}%</p>{job.error&&<p>{job.error}</p>}{job.status==="completed"&&<button onClick={()=>void act(async()=>{await downloadMedia(`/api/editor/exports/${job._id}/download`,"production.mp4");})}>Download MP4</button>}</div>)}{production?.status==="draft"?<div className="agent-budget-approval"><strong>Production budget: {production.estimate.credits??"Unpriced"} credits</strong><p>Approve once. Outputs settle progressively; unused credits are released.</p><Button disabled={busy || !ready || production.estimate.credits==null} onClick={()=>void act(async()=>{await api(`/api/studio/productions/${productionId}/approve`,{method:"POST",body:JSON.stringify({maxCredits:production.estimate.credits})});await refresh();})}>Approve budget and produce</Button></div>:production?.approvedAt?<p className="agent-budget-summary">Budget {production.maxCredits} ? Settled {spent} credits ? {production.status}</p>:null}</>}/></section></aside>}
    </div>
    {(production || sortedScenes.length > 0) && <footer className="studio-footer bottom-0 z-20 border-t border-line bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:sticky">
      <div className="flex gap-2 overflow-x-auto pb-3">{sortedScenes.map((s: any) => <button key={s._id} onClick={() => { setSceneId(s._id); setPreview(false); }} className={`focus-ring w-36 shrink-0 rounded-md border px-3 py-2 text-left text-xs ${scene?._id === s._id ? "border-brand bg-brand/10" : "border-line dark:border-slate-700"}`}><span className="block font-semibold">Scene {s.order}</span><span className="mt-1 block truncate">{s.title}</span><span className="mt-1 block text-slate-500">{steps.filter((step: any) => step.sceneId === String(s._id) && step.status === "completed").length} outputs ready</span></button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        {running && <Button variant="secondary" disabled={busy} onClick={() => act(() => control("pause"))}><Pause size={16} />Pause pending</Button>}
        {production?.status === "paused" && <Button disabled={busy} onClick={() => act(() => control("resume"))}><Play size={16} />Resume</Button>}
        {production?.status === "failed" && <Button disabled={busy} onClick={() => act(() => control("retry"))}><RefreshCw size={16} />Retry failed step</Button>}
        {production && !["completed", "cancelled"].includes(production.status) && <Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm("Cancel pending work? Completed outputs are preserved. Submitted operations may still finish.")) void act(() => control("cancel")); }}><Square size={16} />Cancel pending</Button>}
        {production?.timeline.length > 0 && <><Button variant="secondary" onClick={() => setPreview(!preview)}><Play size={16} />{preview ? "Scene review" : "Preview rough cut"}</Button><button title="Download timeline" aria-label="Download timeline" className="focus-ring grid h-10 w-10 place-items-center rounded-md" onClick={downloadTimeline}><Download size={17} /></button><Link className="focus-ring inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm dark:border-slate-700" to={`/dashboard/video-editor?productionId=${production._id}`}>Continue to Editor<ChevronRight size={16} /></Link></>}
        <div className="ml-auto flex items-center gap-2"><button title="Previous scene" aria-label="Previous scene" disabled={sortedScenes.indexOf(scene) <= 0} className="focus-ring grid h-9 w-9 place-items-center rounded-md disabled:opacity-30" onClick={() => setSceneId(sortedScenes[sortedScenes.indexOf(scene) - 1]._id)}><ChevronLeft size={17} /></button><button title="Next scene" aria-label="Next scene" disabled={sortedScenes.indexOf(scene) >= sortedScenes.length - 1} className="focus-ring grid h-9 w-9 place-items-center rounded-md disabled:opacity-30" onClick={() => setSceneId(sortedScenes[sortedScenes.indexOf(scene) + 1]._id)}><ChevronRight size={17} /></button></div>
      </div>
      {running && <p className="mt-2 text-xs text-slate-500">Already-submitted operations may finish before pending work stops.</p>}
      {["failed", "needs_review", "paused"].includes(production?.status) && <p className="mt-2 text-xs text-slate-500">Unused credits remain reserved for this production. Cancel pending work to release them.</p>}
    </footer>}</div>
  </div>;
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="block text-xs font-semibold">{label}<select className={fieldClass} value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}
