import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, Film, FolderOpen, Loader2, Upload, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { GenerationResults, mediaUrl } from "./GenerationResults";

export function ImageToVideoPage() {
  const initializedModel = useRef(false);
  const [params] = useSearchParams();
  const [config, setConfig] = useState<any>({ models: [], images: [] });
  const [jobs, setJobs] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<any>({ sourceImageAssetId: params.get("imageId") ?? "", motionPrompt: "", model: "veo-3.1-generate-preview", aspectRatio: "16:9", durationSeconds: 8, quality: "720p", quantity: 1, dialogueText: "", dialogueLines: [], dialogueLanguage: "English", preferredAccent: "", characterActions: "", cameraDirection: "", environmentalSounds: "", soundEffects: "", backgroundAmbience: "" });
  const selectedModel = config.models.find((model: any) => model.id === form.model) ?? config.models[0];
  const selectedImage = config.images.find((image: any) => image._id === form.sourceImageAssetId);
  const load = useCallback(async () => {
    const [cfg, history] = await Promise.all([api<any>("/api/videos/config"), api<any>("/api/videos/jobs")]);
    setConfig(cfg); if (!initializedModel.current && cfg.models?.[0]) { initializedModel.current = true; setForm((old: any) => ({ ...old, model: cfg.models[0].id })); } setJobs(history.jobs); setAssets(history.assets);
  }, []);
  useEffect(() => { load().catch(err => setError(err.message)); }, [load]);
  const pending = jobs.some(job => ["queued", "processing", "retrying"].includes(job.status));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { load().catch(err => setError(err.message)); }, 5000);
    return () => clearInterval(timer);
  }, [pending, load]);
  function update(key: string, value: any) {
    setForm((current: any) => ({ ...current, [key]: value })); setQuote(null);
  }
  async function upload(file?: File) {
    if (!file || uploading) return;
    setError(""); setQuote(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setError("Choose a PNG, JPEG, or WebP image up to 10 MB."); return; }
    setUploading(true);
    try {
      const data = await api<any>("/api/videos/source-images", { method: "POST", headers: { "Content-Type": file.type, "x-file-name": encodeURIComponent(file.name) }, body: file });
      setConfig((current: any) => ({ ...current, images: [data.asset, ...current.images.filter((image: any) => image._id !== data.asset._id)] }));
      update("sourceImageAssetId", data.asset._id);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); if (picker.current) picker.current.value = ""; }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const settings = { ...form, dialogueLines: String(form.dialogueText || "").split("\n").filter(line => line.trim()).map(line => { const colon = line.indexOf(":"); return { speaker: colon >= 0 ? line.slice(0, colon).trim() : "Speaker", text: colon >= 0 ? line.slice(colon + 1).trim() : line.trim() }; }) };
      if (!quote) {
        const data = await api<any>("/api/videos/quote", { method: "POST", body: JSON.stringify(settings) }); setQuote(data.quote);
      } else {
        await api("/api/videos/generate", { method: "POST", body: JSON.stringify({ ...settings, approvedCredits: quote.credits }) });
        setQuote(null); await load();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Video request failed"); }
    finally { setBusy(false); }
  }
  function reuse(asset: any) {
    const job = jobs.find(job => job._id === asset.jobId);
    setForm({ ...form, ...(job ?? {}), dialogueText: (job?.dialogueLines ?? []).map((line: any) => line.speaker + ": " + line.text).join("\n"), motionPrompt: asset.prompt ?? "" });
    setQuote(null); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function remove(asset: any) {
    if (!window.confirm("Delete this video clip?")) return;
    try { await api(`/api/videos/assets/${asset._id}`, { method: "DELETE" }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
  }
  return <div className="generation-workspace">
    <header className="generation-heading"><div className="flex items-center gap-2"><Film size={18} className="text-teal-600" /><h1>Image to Video</h1></div><span>Veo</span></header>
    <div className="generation-layout">
      <form onSubmit={submit} className="generation-controls" aria-label="Video settings">
        <header className="control-heading"><h2>Create a video</h2><p>Upload an image, describe motion, then review the cost.</p></header>
        {error && <p role="alert" className="generation-error">{error}</p>}
        <fieldset disabled={busy || uploading}>
          <div className="control-section">
            <div className="control-title"><h2>1. Upload image</h2><button type="button" className="text-xs font-semibold text-brand dark:text-brand-dark" onClick={() => library.current?.showModal()}><FolderOpen size={14} className="mr-1 inline" />Library</button></div>
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload source image" className="sr-only" onChange={e => void upload(e.target.files?.[0])} />
            <div className={`image-upload ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); if (!busy && !uploading) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !uploading) void upload(e.dataTransfer.files[0]); }}>
              <button type="button" onClick={() => picker.current?.click()} aria-label={selectedImage ? "Replace source image" : "Choose image to upload"} className="upload-target">
                {selectedImage ? <img src={mediaUrl(selectedImage.url)} alt="Selected source image" /> : <><Upload size={24} strokeWidth={1.5} /><strong>Click or drop an image</strong><span>PNG, JPG, WebP / 10 MB max</span></>}
              </button>
              {selectedImage && <button type="button" className="upload-remove" title="Remove selection" aria-label="Remove source image" onClick={() => update("sourceImageAssetId", "")}><X size={14} /></button>}
              {uploading && <div className="upload-progress" role="status"><Loader2 size={18} className="animate-spin" />Uploading...</div>}
            </div>
            {selectedImage && <p className="source-caption"><Check size={12} />{selectedImage.metadata?.name || "Library image"}{selectedImage.width ? ` / ${selectedImage.width} x ${selectedImage.height}` : ""}</p>}
          </div>
          <div className="control-section"><label className="compact-label">2. Motion prompt<textarea required minLength={3} maxLength={4000} value={form.motionPrompt} onChange={e => update("motionPrompt", e.target.value)} placeholder="Describe movement, camera direction, and atmosphere..." className="compact-input prompt-input" /></label></div>
          <details className="control-section"><summary>Dialogue and native sound</summary><p className="mt-2 text-xs text-slate-500">Veo generates speech and sound with the video. Use up to 14 spoken words for an eight-second clip. Words, voice consistency and lip-sync require review.</p><label className="compact-label mt-3">Dialogue (one Speaker: line per turn)<textarea className="compact-input" value={form.dialogueText || ""} onChange={e => update("dialogueText", e.target.value)} /></label>{([['dialogueLanguage', 'Dialogue language'], ['preferredAccent', 'Accent preference'], ['emotionAndDelivery', 'Emotion and delivery'], ['characterDescriptions', 'Character descriptions'], ['characterActions', 'Character actions'], ['cameraDirection', 'Camera direction'], ['environmentalSounds', 'Environmental sounds'], ['soundEffects', 'Sound effects'], ['backgroundAmbience', 'Background ambience']] as const).map(([key, label]) => <label className="compact-label mt-3" key={key}>{label}<input className="compact-input" value={form[key] || ""} onChange={e => update(key, e.target.value)} /></label>)}</details>
          <div className="control-section">
            <h2 className="mb-3">3. Video settings</h2>
            <Select label="Model" value={form.model} options={config.models.map((m: any) => m.id)} labels={Object.fromEntries(config.models.map((m: any) => [m.id, m.label || m.id]))} onChange={value => { const model = config.models.find((m: any) => m.id === value); setForm({ ...form, model: value, aspectRatio: model.aspectRatios[0], durationSeconds: model.durations[0], quality: model.qualities[0], quantity: 1 }); setQuote(null); }} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Select label="Aspect ratio" value={form.aspectRatio} options={selectedModel?.aspectRatios ?? []} onChange={v => update("aspectRatio", v)} />
              <Select label="Duration" value={String(form.durationSeconds)} options={(selectedModel?.durations ?? []).map(String)} labels={Object.fromEntries((selectedModel?.durations ?? []).map((d: number) => [d, `${d} seconds`]))} onChange={v => update("durationSeconds", Number(v))} />
              <Select label="Quality" value={form.quality} options={selectedModel?.qualities ?? []} onChange={v => update("quality", v)} />
              <label className="compact-label">Outputs<input className="compact-input" type="number" min={1} max={selectedModel?.maxQuantity ?? 1} value={form.quantity} onChange={e => update("quantity", Number(e.target.value))} /></label>
            </div>
          </div>
        </fieldset>
        <div className="generation-submit"><div className="flex justify-between text-xs"><span className="text-slate-500">Credit estimate</span><strong>{quote ? `${quote.credits} credits` : "Not calculated"}</strong></div><Button className="mt-3 w-full" disabled={busy || uploading || !selectedImage || form.motionPrompt.trim().length < 3}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}{busy ? "Please wait..." : quote ? `Generate / ${quote.credits} credits` : "Preview cost"}</Button></div>
      </form>
      <GenerationResults kind="video" assets={assets} jobs={jobs} busy={busy} onRefresh={() => load().catch(err => setError(err.message))} onRegenerate={reuse} onDelete={remove} />
    </div>
    <dialog ref={library} className="media-picker" aria-label="Image library">
      <header><h2>Image library</h2><button type="button" className="tool-icon" title="Close library" aria-label="Close library" onClick={() => library.current?.close()}><X size={18} /></button></header>
      <div className="media-picker-grid">{config.images.map((image: any) => <button key={image._id} onClick={() => { update("sourceImageAssetId", image._id); library.current?.close(); }} aria-label={`Select ${image.metadata?.name || "image"}`}><img src={mediaUrl(image.url)} alt={image.metadata?.name || "Library image"} loading="lazy" /><span>{image.metadata?.name || image.prompt?.slice(0, 50) || "Generated image"}</span></button>)}</div>
      {!config.images.length && <p className="output-empty">No images in your library.</p>}
    </dialog>
  </div>;
}
function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
  return <label className="compact-label">{label}<select className="compact-input" value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option} value={option}>{labels[option] || option}</option>)}</select></label>;
}
