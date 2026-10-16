import { useAutomaticQuote } from "../../lib/useAutomaticQuote";
import { FormEvent, useCallback, useEffect, useState, useRef } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { GenerationResults } from "./GenerationResults";

export function TextToImagePage() {
  const initializedModel = useRef(false);
  const [config, setConfig] = useState<any>({ models: [], stylePresets: [], characters: [] });
  const [jobs, setJobs] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<any>({ prompt: "", stylePreset: "Cinematic", model: "gemini-nano-banana-2.1", aspectRatio: "16:9", resolution: "1K", numberOfImages: 1, characterReferenceIds: [] });
  useAutomaticQuote("/api/images/quote", form, !busy && form.prompt.trim().length >= 3, setQuote, setError);
  const selectedModel = config.models.find((model: any) => model.id === form.model) ?? config.models[0];
  const load = useCallback(async () => {
    const [cfg, history] = await Promise.all([api<any>("/api/images/config"), api<any>("/api/images/jobs")]);
    setConfig(cfg); if (!initializedModel.current && cfg.models?.[0]) { initializedModel.current = true; setForm((old: any) => ({ ...old, model: cfg.models[0].id })); } setJobs(history.jobs); setAssets(history.assets);
  }, []);
  useEffect(() => { load().catch(err => setError(err.message)); }, [load]);
  const pending = jobs.some(job => ["queued", "processing", "retrying"].includes(job.status));
  useEffect(() => { if (!pending) return; const timer = setInterval(() => { load().catch(err => setError(err.message)); }, 5000); return () => clearInterval(timer); }, [pending, load]);
  function update(key: string, value: any) { setForm((current: any) => ({ ...current, [key]: value })); setQuote(null); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!quote) { const data = await api<any>("/api/images/quote", { method: "POST", body: JSON.stringify(form) }); setQuote(data.quote); }
      else {
        await api("/api/images/generate", { method: "POST", body: JSON.stringify({ ...form, approvedCredits: quote.credits }) });
        setQuote(null); await load();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Image request failed"); }
    finally { setBusy(false); }
  }
  function reuse(asset: any) {
    const job = jobs.find(job => job._id === asset.jobId);
    setForm({ ...form, ...(job ? { model: job.model, stylePreset: job.stylePreset, aspectRatio: job.aspectRatio, resolution: job.resolution, numberOfImages: job.numberOfImages, characterReferenceIds: job.characterReferenceIds ?? [] } : {}), prompt: asset.prompt ?? "" });
    setQuote(null); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function remove(asset: any) {
    if (!window.confirm("Delete this image?")) return;
    try { await api(`/api/images/assets/${asset._id}`, { method: "DELETE" }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
  }
  return <div className="generation-workspace">
    <header className="generation-heading"><div className="flex items-center gap-2"><ImageIcon size={18} className="text-teal-600" /><h1>Text to Image</h1></div><span>{form.model.startsWith("openrouter/") ? "OpenRouter" : "Gemini"}</span></header>
    <div className="generation-layout">
      <form className="generation-controls" aria-label="Image settings" onSubmit={submit}>
        <header className="control-heading"><h2>Create an image</h2><p>Describe your image, choose a style, then review the cost.</p></header>
        {error && <p role="alert" className="generation-error">{error}</p>}
        <fieldset disabled={busy}>
          <div className="control-section"><label className="compact-label">Prompt<textarea className="compact-input prompt-input image-prompt" required minLength={3} maxLength={4000} value={form.prompt} placeholder="Describe your subject, setting, lighting, and composition..." onChange={e => update("prompt", e.target.value)} /></label><span className="mt-1 block text-right text-[11px] text-slate-500">{form.prompt.length} / 4,000</span></div>
          <div className="control-section"><h2 className="mb-3">Style</h2><div className="style-presets" role="group" aria-label="Image style">{config.stylePresets.map((style: string) => <button key={style} type="button" aria-pressed={form.stylePreset === style} onClick={() => update("stylePreset", style)}>{style}</button>)}</div></div>
          <div className="control-section"><h2 className="mb-3">Generation settings</h2>
            <Select label="Model" value={form.model} options={config.models.map((model: any) => model.id)} labels={Object.fromEntries(config.models.map((m: any) => [m.id, m.label || m.id]))} onChange={value => { const model = config.models.find((m: any) => m.id === value); setForm({ ...form, model: value, aspectRatio: model.aspectRatios[0], resolution: model.resolutions[0], numberOfImages: 1, characterReferenceIds: [] }); setQuote(null); }} />
            <div className="mt-3 grid grid-cols-2 gap-3"><Select label="Aspect ratio" value={form.aspectRatio} options={selectedModel?.aspectRatios ?? []} onChange={v => update("aspectRatio", v)} /><Select label="Resolution" value={form.resolution} options={selectedModel?.resolutions ?? []} onChange={v => update("resolution", v)} />
            <label className="compact-label">Images<input className="compact-input" type="number" min={1} max={selectedModel?.maxImages ?? 1} value={form.numberOfImages} onChange={e => update("numberOfImages", Number(e.target.value))} /></label>
            {selectedModel?.characterReference && <Select label="Character" value={form.characterReferenceIds[0] ?? ""} options={["", ...config.characters.map((c: any) => c._id)]} labels={{ "": "None", ...Object.fromEntries(config.characters.map((c: any) => [c._id, c.name])) }} onChange={value => update("characterReferenceIds", value ? [value] : [])} />}</div>
          </div>
        </fieldset>
        <div className="generation-submit">{quote?.model && <p className="mb-2 text-xs text-slate-500">Model for this quote: {quote.model.replace("openrouter/", "")}</p>}<div className="flex justify-between text-xs"><span className="text-slate-500">Credit estimate</span><strong>{quote ? `${quote.credits} credits` : "Not calculated"}</strong></div><Button className="mt-3 w-full" disabled={busy || form.prompt.trim().length < 3}>{busy ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}{busy ? "Please wait..." : quote ? `Generate / ${quote.credits} credits` : "Preview cost"}</Button></div>
      </form>
      <GenerationResults kind="image" assets={assets} jobs={jobs} busy={busy} onRefresh={() => load().catch(err => setError(err.message))} onRegenerate={reuse} onDelete={remove} />
    </div>
  </div>;
}
function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
  return <label className="compact-label">{label}<select className="compact-input" value={value} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option} value={option}>{labels[option] || option}</option>)}</select></label>;
}
