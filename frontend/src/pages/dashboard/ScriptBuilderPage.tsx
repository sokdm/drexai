import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Loader } from "../../components/ui/Loader";
import { api } from "../../lib/api";
import { Field, TextArea, quote } from "./aiShared";

export function ScriptBuilderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [niches, setNiches] = useState<any[]>([]);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState(() => localStorage.getItem("drex-script-job") || "");
  const [jobStatus, setJobStatus] = useState("");
  const [settings, setSettings] = useState<any>({ storyTopic: "A cinematic faceless story about a hidden city under the ocean", type: "Animated story", genre: "Adventure", language: "English", targetDuration: "8 minutes", numberOfCharacters: 3, visualStyle: "cinematic 3D animation", dialoguePreference: "Narration-led", audience: "teens and adults", tone: "mysterious and inspiring" });
  useEffect(() => { api<any>("/api/ai/niches").then((d) => setNiches(d.niches || [])).catch(err => setError(err.message)); }, []);
  useEffect(() => { const id = params.get("projectId"); if (id) api<any>(`/api/ai/projects/${id}`).then(d => setProject(d.project)).catch(e => setError(e.message)); }, [params.get("projectId")]);
  async function generate(event: FormEvent) {
    event.preventDefault(); if (loading || jobId) return; setLoading(true); setError("");
    try {
      const approvedCredits = await quote("story_generation");
      const data = await api<any>("/api/ai/scripts/generate", { method: "POST", body: JSON.stringify({ settings, approvedCredits, background: true, requestId: crypto.randomUUID() }) });
      if (data.project) { setProject(data.project); setLoading(false); }
      else if (data.job?._id) { localStorage.setItem("drex-script-job", data.job._id); setJobId(data.job._id); setJobStatus(data.job.status); }
      else throw new Error("The server did not confirm a script request. Check Projects before retrying.");
    } catch (err) { setLoading(false); setError(err instanceof Error ? err.message : "Script generation failed"); }
  }
  useEffect(() => {
    if (!jobId) return; let active = true; setLoading(true);
    const poll = async () => { try {
      const data = await api<any>("/api/ai/scripts/jobs/" + jobId); if (!active) return;
      setJobStatus(data.job.status);
      if (["completed", "failed", "needs_review"].includes(data.job.status)) {
        if (data.project) setProject(data.project);
        if (data.job.error) setError(data.job.error);
        localStorage.removeItem("drex-script-job"); setJobId(""); setLoading(false);
      }
    } catch (err) { if (active) {
      const message = err instanceof Error ? err.message : "Reconnecting to script request"; setError(message);
      if (message === "Script request not found") { localStorage.removeItem("drex-script-job"); setJobId(""); setLoading(false); }
    } } };
    void poll(); const timer = setInterval(() => void poll(), 3500); return () => { active = false; clearInterval(timer); };
  }, [jobId]);
  useEffect(() => {
    const id = params.get("projectId");
    if (id) api<any>(`/api/ai/projects/${id}`).then(data => setProject(data.project)).catch(err => setError(err.message));
  }, [params]);
  async function approveScript() {
    setSaving(true); setError("");
    try {
      await saveScenes();
      const data = await api<any>(`/api/ai/projects/${project._id}/approve`, { method: "POST", body: "{}" });
      setProject(data.project);
    } catch (err) { setError(err instanceof Error ? err.message : "Approval failed"); }
    finally { setSaving(false); }
  }
  async function continueInStudio() {
    setSaving(true); setError("");
    try {
      await api(`/api/ai/projects/${project._id}/continue-ai-studio`, { method: "POST", body: "{}" });
      navigate(`/dashboard/ai-studio?projectId=${project._id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not open Studio"); }
    finally { setSaving(false); }
  }
  async function saveScenes() { const data = await api<any>(`/api/ai/projects/${project._id}/scenes`, { method: "PATCH", body: JSON.stringify({ scenes: project.scenes }) }); setProject(data.project); }
  return <div className="script-workspace grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]"><section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-3xl font-black">Script Builder</h2>{error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}<form className="mt-6 space-y-4" onSubmit={generate}><TextArea label="Story topic" value={settings.storyTopic} onChange={(v) => setSettings({ ...settings, storyTopic: v })} /><label className="block text-sm font-semibold">Niche<select value={settings.nicheId ?? ""} onChange={(e) => setSettings({ ...settings, nicheId: e.target.value })} className="mt-2 h-11 w-full rounded-md border border-line bg-transparent px-3 dark:border-slate-700"><option value="">No niche</option>{niches.map((n) => <option key={n._id} value={n._id}>{n.name}</option>)}</select></label>{["type", "genre", "language", "targetDuration", "visualStyle", "audience", "tone"].map((key) => <Field key={key} label={({ type: "Video type", genre: "Genre", language: "Language", targetDuration: "Target duration", visualStyle: "Visual style", audience: "Audience", tone: "Tone" } as Record<string, string>)[key]} value={settings[key] ?? ""} onChange={(v) => setSettings({ ...settings, [key]: v })} />)}<Button disabled={loading}>{loading ? "Generating..." : "Generate structured script"}</Button></form></section><section className="space-y-4">{loading && <div role="status"><Loader label="AI is planning scenes" /><p className="mt-3 text-center text-sm text-slate-500">Request status: {jobStatus || "starting"}. This request is saved. Reopen Script Builder to recover its result.</p></div>}{!loading && !project && <div className="rounded-md border border-line p-6 dark:border-slate-800"><h2 className="font-bold">Your script appears here</h2><p className="mt-2 text-sm text-slate-500">Enter a topic, then generate a script to review and edit its scenes.</p></div>}{project && <><div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-2xl font-black">{project.title}</h2><p className="mt-2 text-slate-600 dark:text-slate-300">{project.summary}</p><div className="mt-4 flex flex-wrap gap-2"><Button onClick={saveScenes}>Save version</Button><Button variant="secondary" disabled={saving} onClick={approveScript}>{project.approvedAt ? "Approved" : "Approve script"}</Button><Button variant="secondary" disabled={saving || !project.approvedAt} onClick={continueInStudio}>Continue in AI Studio</Button></div></div>{project.scenes.map((scene: any, index: number) => <SceneEditor scene={scene} key={scene._id ?? index} onChange={(updated) => { const scenes = [...project.scenes]; scenes[index] = updated; setProject({ ...project, scenes, approvedAt: undefined }); }} />)}</>}</section></div>;
}

function SceneEditor({ scene, onChange }: { scene: any; onChange: (scene: any) => void }) {
  return <div className="rounded-md border border-line bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-black">Scene {scene.order}: {scene.title}</h3><div className="mt-4 grid gap-4 md:grid-cols-2"><TextArea label="Off-screen narration" value={scene.narration ?? ""} onChange={(v) => onChange({ ...scene, narration: v })} /><TextArea label="Dialogue" value={scene.dialogueLines?.length ? scene.dialogueLines.map((line: any) => `${line.speaker}: ${line.text}`).join("\n") : scene.dialogue ?? ""} onChange={(v) => onChange({ ...scene, dialogue: v, dialogueLines: undefined })} /><TextArea label="Image prompt" value={scene.imagePrompt ?? ""} onChange={(v) => onChange({ ...scene, imagePrompt: v })} /><TextArea label="Motion prompt" value={scene.videoMotionPrompt ?? ""} onChange={(v) => onChange({ ...scene, videoMotionPrompt: v })} /></div><details className="mt-4"><summary>Native dialogue and sound directions</summary><p className="my-3 text-sm text-slate-500">Use Speaker: dialogue on each line. Veo generates the speech with the footage. Keep each eight-second segment to about 14 words; review mouth movements and voices after generation.</p><div className="grid gap-3 md:grid-cols-2">{([['dialogueLanguage', 'Dialogue language'], ['preferredAccent', 'Preferred accent'], ['emotionAndDelivery', 'Emotion and delivery'], ['characterActions', 'Character actions'], ['cameraPosition', 'Camera position'], ['cameraMovements', 'Camera movements'], ['environmentalSounds', 'Environmental sounds'], ['soundEffects', 'Sound effects'], ['backgroundAmbience', 'Background ambience']] as const).map(([key, label]) => <Field key={key} label={label} value={scene[key] || ""} onChange={v => onChange({ ...scene, [key]: v })} />)}</div><label className="mt-3 block text-sm"><input type="checkbox" checked={scene.visibleSpeakingCharacters ?? Boolean(scene.dialogue?.trim() || scene.dialogueLines?.length)} onChange={e => onChange({ ...scene, visibleSpeakingCharacters: e.target.checked })} /> Visible speaking characters</label><label className="mt-3 block text-sm"><input type="checkbox" checked={scene.offscreenNarration ?? !(scene.dialogue?.trim() || scene.dialogueLines?.length)} onChange={e => onChange({ ...scene, offscreenNarration: e.target.checked })} /> Include separate off-screen narration</label></details></div>;
}
