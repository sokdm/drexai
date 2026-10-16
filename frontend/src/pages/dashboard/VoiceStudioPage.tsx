import { FormEvent, useEffect, useMemo, useState, useRef } from "react";
import { Download, Mic2, Play, RefreshCw, Send, Trash2, Volume2 } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Loader } from "../../components/ui/Loader";
import { api } from "../../lib/api";

type SpeakerLine = { speaker: string; voice: string; text: string; style?: string };

export function VoiceStudioPage() {
  const initializedModel = useRef(false);
  const [config, setConfig] = useState<any>({ models: [], projects: [] });
  const [jobs, setJobs] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<any>({
    text: "In a quiet city after midnight, a faceless storyteller discovers a hidden pattern behind every viral video.",
    model: "gemini-3.8-flash-tts",
    voiceId: "Kore",
    language: "English",
    style: "cinematic",
    mode: "single",
    projectId: "",
    sceneId: "",
    characterName: "",
    speakers: [
      { speaker: "Narrator", voice: "Kore", text: "The channel needed a voice that felt calm, clear, and impossible to ignore.", style: "cinematic" },
      { speaker: "Creator", voice: "Puck", text: "Then we turn the idea into a repeatable production system.", style: "energetic" }
    ] as SpeakerLine[]
  });

  const selectedModel = useMemo(() => config.models.find((model: any) => model.id === form.model) ?? config.models[0], [config.models, form.model]);
  const selectedProject = useMemo(() => config.projects.find((project: any) => project._id === form.projectId), [config.projects, form.projectId]);
  const selectedScene = selectedProject?.scenes?.find((scene: any) => scene._id === form.sceneId);

  async function load() {
    const [cfg, library] = await Promise.all([api<any>("/api/voice/config"), api<any>("/api/voice/library")]);
    setConfig(cfg); if (!initializedModel.current && cfg.models?.[0]) { initializedModel.current = true; setForm((old: any) => ({ ...old, model: cfg.models[0].id })); }
    setJobs(library.jobs);
    setAssets(library.assets);
  }

  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  async function previewQuote(nextForm = form) {
    const data = await api<any>("/api/voice/quote", { method: "POST", body: JSON.stringify(cleanPayload(nextForm)) });
    setQuote(data.quote);
    return data.quote;
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const approved = quote ?? await previewQuote();
      await api("/api/voice/generate", { method: "POST", body: JSON.stringify({ ...cleanPayload(form), approvedCredits: approved.credits }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice generation failed");
    } finally {
      setLoading(false);
    }
  }

  function update(key: string, value: any) {
    const next = { ...form, [key]: value };
    if (key === "model") {
      const model = config.models.find((item: any) => item.id === value);
      next.voiceId = model?.voices?.[0] ?? "Kore";
      next.language = model?.languages?.[0] ?? "English";
      next.style = model?.styles?.[0] ?? "calm";
      next.mode = model?.multiSpeaker ? next.mode : "single";
    }
    if (key === "projectId") next.sceneId = "";
    setForm(next);
    setQuote(null);
  }

  function useSceneText(kind: "narration" | "dialogue") {
    if (!selectedScene) return;
    update("text", selectedScene[kind] || selectedScene.sceneDescription || "");
  }

  function updateSpeaker(index: number, key: keyof SpeakerLine, value: string) {
    const speakers = form.speakers.map((speaker: SpeakerLine, itemIndex: number) => itemIndex === index ? { ...speaker, [key]: value } : speaker);
    setForm({ ...form, speakers });
    setQuote(null);
  }

  function addSpeaker() {
    setForm({ ...form, speakers: [...form.speakers, { speaker: `Speaker ${form.speakers.length + 1}`, voice: selectedModel?.voices?.[0] ?? "Kore", text: "", style: form.style }] });
    setQuote(null);
  }

  return (
    <div className="min-h-screen bg-[#101114] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#101114]/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">

            <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-500 text-black"><Mic2 /></span>
            <div>
              <h1 className="text-xl font-bold">AI Voice Studio</h1>
            </div>
          </div>
          <span className="text-xs text-zinc-400">Gemini TTS</span>
        </div>
      </header>

      <div className="voice-layout grid min-h-[calc(100dvh-110px)] gap-0 lg:grid-cols-[312px_minmax(0,1fr)] 2xl:grid-cols-[336px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-[#17191f] p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><Volume2 size={16} /> Voice settings</div>
          {error && <p className="mb-4 rounded-xl border border-red-500/30 bg-red-950/50 p-3 text-sm font-bold text-red-100">{error}</p>}
          <form className="space-y-4" onSubmit={generate}>
            <Select label="Model" value={form.model} options={config.models.map((model: any) => model.id)} onChange={(value) => update("model", value)} />
            <div className="grid grid-cols-2 gap-3">
            <Select label="Mode" value={form.mode} options={selectedModel?.multiSpeaker ? ["single", "multi"] : ["single"]} onChange={(value) => update("mode", value)} />
            <Select label="Voice" value={form.voiceId} options={selectedModel?.voices ?? []} onChange={(value) => update("voiceId", value)} />
            <Select label="Language" value={form.language} options={selectedModel?.languages ?? []} onChange={(value) => update("language", value)} />
            <Select label="Style" value={form.style} options={selectedModel?.styles ?? []} onChange={(value) => update("style", value)} />
            </div>
            <details className="border-y border-white/10 py-3"><summary className="cursor-pointer text-xs font-semibold text-zinc-400">Project & character</summary><div className="mt-3 space-y-3">
            <Select label="Attach to project" value={form.projectId} options={["", ...config.projects.map((project: any) => project._id)]} labels={{ "": "None", ...Object.fromEntries(config.projects.map((project: any) => [project._id, project.title])) }} onChange={(value) => update("projectId", value)} />
            {selectedProject && <Select label="Scene" value={form.sceneId} options={["", ...(selectedProject.scenes ?? []).map((scene: any) => scene._id)]} labels={{ "": "No scene", ...Object.fromEntries((selectedProject.scenes ?? []).map((scene: any) => [scene._id, scene.title || `Scene ${scene.order}`])) }} onChange={(value) => update("sceneId", value)} />}
            <label className="block text-sm font-semibold text-zinc-300">Character name<input value={form.characterName} onChange={(event) => update("characterName", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#101114] px-3 text-white outline-none focus:border-cyan-400" /></label>
            {selectedScene && <div className="grid grid-cols-2 gap-2"><Button type="button" variant="secondary" onClick={() => useSceneText("narration")}>Use narration</Button><Button type="button" variant="secondary" onClick={() => useSceneText("dialogue")}>Use dialogue</Button></div>}
            </div></details>

            {form.mode === "single" ? (
              <label className="block text-sm font-semibold text-zinc-300">Text<input aria-hidden className="hidden" readOnly value="" /><textarea value={form.text} onChange={(event) => update("text", event.target.value)} className="mt-2 min-h-40 w-full rounded-lg border border-white/10 bg-[#101114] p-3 text-white outline-none focus:border-cyan-400" /></label>
            ) : (
              <div className="space-y-3">
                {form.speakers.map((speaker: SpeakerLine, index: number) => <div className="rounded-xl border border-white/10 bg-[#101114] p-3" key={index}>
                  <div className="grid gap-2 sm:grid-cols-2"><input value={speaker.speaker} onChange={(event) => updateSpeaker(index, "speaker", event.target.value)} className="h-10 rounded-lg border border-white/10 bg-transparent px-3 text-sm" /><select value={speaker.voice} onChange={(event) => updateSpeaker(index, "voice", event.target.value)} className="h-10 rounded-lg border border-white/10 bg-transparent px-3 text-sm">{(selectedModel?.voices ?? []).map((voice: string) => <option key={voice}>{voice}</option>)}</select></div>
                  <textarea value={speaker.text} onChange={(event) => updateSpeaker(index, "text", event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-white/10 bg-transparent p-3 text-sm" />
                </div>)}
                <Button type="button" variant="secondary" onClick={addSpeaker}>Add speaker</Button>
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-[#101114] p-4">
              <p className="font-black">{quote ? `${quote.credits} credits` : "Preview cost before generating"}</p>
            </div>
            <div className="grid grid-cols-2 gap-2"><Button type="button" variant="secondary" disabled={loading} onClick={() => previewQuote().catch(err => setError(err.message))}>Preview cost</Button><Button disabled={loading || !quote}><Send size={15} /> {loading ? "Generating..." : "Generate"}</Button></div>
          </form>
        </aside>

        <main className="space-y-6 p-4">
          {loading && <Loader label="Generating narration" />}
          <section className="border-b border-white/10 pb-5" aria-label="Audio results">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 className="text-lg font-semibold">Audio results</h2></div>
              <Button variant="secondary" onClick={load}><RefreshCw size={16} /> Refresh</Button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {assets.map((asset) => <AudioCard key={asset._id} asset={asset} projects={config.projects} reload={load} />)}
              {assets.length === 0 && <div className="col-span-full grid min-h-60 place-items-center rounded-md border border-white/10 bg-[#17191f] text-zinc-500"><div className="space-y-3 text-center"><Volume2 size={30} strokeWidth={1.25} className="mx-auto" /><p className="text-sm">No audio generated yet.</p></div></div>}
            </div>
          </section>
          <section className="py-2">
            <h2 className="text-sm font-semibold">Generation history</h2>
            {!jobs.length && <p className="py-6 text-center text-xs text-zinc-500">No generation history.</p>}
            <div className="mt-4 space-y-2">{jobs.map((job) => <div className="rounded-xl border border-white/10 bg-[#101114] p-3 text-sm" key={job._id}><strong>{job.status}</strong> · {job.model} · {job.voiceId} · {job.approvedCredits ?? 0} credits · {job.durationSeconds ?? 0}s<br /><span className="text-zinc-400">{job.mode === "multi" ? `${job.speakers?.length ?? 0} speakers` : job.text}</span></div>)}</div>
          </section>
        </main>
      </div>
    </div>
  );
}

function cleanPayload(form: any) {
  return {
    ...form,
    projectId: form.projectId || undefined,
    sceneId: form.sceneId || undefined,
    characterName: form.characterName || undefined,
    speakers: form.mode === "multi" ? form.speakers.filter((speaker: SpeakerLine) => speaker.text.trim()) : []
  };
}

function AudioCard({ asset, projects, reload }: { asset: any; projects: any[]; reload: () => Promise<void> }) {
  const [url, setUrl] = useState(asset.url);
  const [name, setName] = useState(asset.metadata?.name ?? "");
  async function ensureUrl() {
    const data = await api<{ url: string }>(`/api/voice/assets/${asset._id}/url`);
    setUrl(data.url);
  }
  useEffect(() => { ensureUrl().catch(() => null); }, [asset._id]);
  return <article className="rounded-xl border border-white/10 bg-[#101114] p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="font-black">{asset.metadata?.name || asset.characterName || "Generated voice"}</p><p className="text-xs text-zinc-500">{asset.voiceId} · {asset.durationSeconds ?? 0}s · {asset.provider}</p></div><Play size={18} className="text-cyan-300" /></div>
    <audio src={url} controls className="mt-3 w-full" />
    <p className="mt-3 line-clamp-2 text-sm text-zinc-300">{asset.prompt}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Asset name" className="h-10 rounded-lg border border-white/10 bg-transparent px-3 text-sm" /><Button variant="secondary" onClick={() => api(`/api/voice/assets/${asset._id}`, { method: "PATCH", body: JSON.stringify({ name }) }).then(reload)}>Rename</Button></div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2"><select className="h-10 rounded-lg border border-white/10 bg-transparent px-3 text-sm" defaultValue={asset.projectId ?? ""} onChange={(event) => api(`/api/voice/assets/${asset._id}`, { method: "PATCH", body: JSON.stringify({ projectId: event.target.value || undefined }) }).then(reload)}><option value="">No project</option>{projects.map((project) => <option key={project._id} value={project._id}>{project.title}</option>)}</select><Button variant="secondary">AI Studio</Button></div>
    <div className="mt-3 flex flex-wrap gap-2"><a href={url} download><Button variant="secondary"><Download size={15} /></Button></a><Button variant="secondary"><RefreshCw size={15} /></Button><Button variant="secondary" onClick={() => api(`/api/voice/assets/${asset._id}`, { method: "DELETE" }).then(reload)}><Trash2 size={15} /></Button></div>
  </article>;
}

function Select({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="block text-sm font-semibold text-zinc-300">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#101114] px-3 text-white outline-none focus:border-cyan-400">{options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select></label>;
}
