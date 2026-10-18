import { AIAssistantPage } from "./AIAssistantPage";
import { StudioStoryboard } from "./StudioStoryboard";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

export function ProductCommercial({ onReady }: { onReady: (project: any) => void }) {
 const [brief, setBrief] = useState({ name: "", benefits: "", audience: "", callToAction: "", seconds: 30 });
 const [asset, setAsset] = useState<any>(null), [preview, setPreview] = useState("");
 const [commercialScene,setCommercialScene] = useState("");
 const [project,setProject] = useState<any>(null);
 const [quote, setQuote] = useState<any>(null), [job, setJob] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
 const requestId = useRef(crypto.randomUUID());
 useEffect(() => { try { const id = localStorage.getItem("drex-commercial-job"); if (id) setJob({ _id: id, status: "queued", logs: [] }); } catch {} }, []);
 useEffect(() => {
  if (!job?._id || ["completed", "failed", "needs_review"].includes(job.status)) return;
  let alive = true;
  const poll = async () => { try {
   const data = await api<any>(`/api/ai/scripts/jobs/${job._id}`); if (!alive) return; setJob(data.job);
   if (["completed", "failed", "needs_review"].includes(data.job.status)) { localStorage.removeItem("drex-commercial-job"); if (data.job.error) setError(data.job.error); if (data.project) {setProject(data.project);if(data.job.status==="completed")onReady(data.project);} window.dispatchEvent(new Event("wallet:refresh")); }
  } catch (e: any) { if (alive) setError(`Reconnecting to saved production brief: ${e.message}`); } };
  void poll(); const timer = setInterval(() => void poll(), 4000); return () => { alive = false; clearInterval(timer); };
 }, [job?._id, job?.status]);
 useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
 const running = job && !["completed", "failed", "needs_review"].includes(job.status);
 async function upload(file?: File) { if (!file) return; setBusy(true); setError(""); try {
  const data = await api<any>("/api/images/studio/upload", { method: "POST", headers: { "Content-Type": file.type }, body: file });
  setAsset(data.asset); setPreview(URL.createObjectURL(file)); setQuote(null);
 } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
 async function prepare() {
  if (!asset) return; setBusy(true); setError("");
  const settings = { modelMode: "auto", storyTopic: `Create an original product commercial for ${brief.name}. Use only supplied benefits. Do not invent testimonials, certifications or performance claims. End with the supplied call to action.`, type: "Product commercial", sceneCount: Math.min(40, Math.max(1, Math.ceil(brief.seconds / 5))), targetDuration: `${brief.seconds} seconds`, visualStyle: "Premium product photography", audience: brief.audience || "General audience", product: { name: brief.name, benefits: brief.benefits, audience: brief.audience, callToAction: brief.callToAction, assetIds: [asset._id] } };
  try {
   if (!quote) { const data = await api<any>("/api/ai/scripts/quote", { method: "POST", body: JSON.stringify({ settings }) }); if (!data.quote.allowed) throw new Error(data.quote.reason); setQuote(data.quote); return; }
   const data = await api<any>("/api/ai/scripts/generate", { method: "POST", body: JSON.stringify({ settings, approvedCredits: quote.credits, requestId: requestId.current }) });
   setJob(data.job); localStorage.setItem("drex-commercial-job", data.job._id); setQuote(null); requestId.current = crypto.randomUUID();
  } catch (e: any) { setError(e.message); } finally { setBusy(false); }
 }
 return <section className="commercial-workspace"><aside className="image-panel"><h2>Project setup</h2><span className="commercial-mode-badge">Product commercial</span><p>Upload your product, prepare a script, then review scenes before paid media production.</p>{Object.entries({ name: "Product name", benefits: "Verified product benefits", audience: "Audience", callToAction: "Call to action" }).map(([key,label]) => <label key={key}>{label}<textarea rows={key === "benefits" ? 4 : 2} value={(brief as any)[key]} disabled={busy || running} onChange={e => { setBrief({ ...brief, [key]: e.target.value }); setQuote(null); }} /></label>)}<label>Duration in seconds<input type="number" min={5} max={600} value={brief.seconds} disabled={busy || running} onChange={e => { setBrief({ ...brief, seconds: Number(e.target.value) }); setQuote(null); }} /></label><label>Product image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || running} onChange={e => void upload(e.target.files?.[0])} /></label><button className="image-primary" disabled={busy || running || !asset || brief.name.trim().length < 1 || brief.benefits.trim().length < 2} onClick={() => void prepare()}>{busy ? "Preparing" : running ? "Writing saved script" : quote ? `Approve ${quote.credits} credits for script` : "Review script cost"}</button>{quote && <p>Script only: {quote.credits} credits. Images, video and audio require a separate production quote.</p>}{error && <p role="alert">{error}</p>}</aside><main className="image-panel commercial-preview"><div className="reference-project-heading"><div><h2>{brief.name ? brief.name + " / Product Commercial" : "Your product commercial"}</h2><p>{brief.benefits || "Create a commercial using your own product references."}</p></div><span>{brief.seconds}s</span></div>{preview ? <img src={preview} alt="Your uploaded product reference" /> : <div><h2>Your product, your creative direction</h2><p>A real product preview appears after upload. No generated media exists until you approve generation.</p></div>}<StudioStoryboard scenes={project?.scenes || []} steps={[]} assets={[]} urls={{}} selectedId={commercialScene || project?.scenes?.[0]?._id} onScene={setCommercialScene} time={0} />{project && <Link to={`/dashboard/script-builder?projectId=${project._id}`}>Review commercial scenes and continue to production</Link>}</main><aside className="commercial-assistant"><h2>AI Production Assistant</h2><AIAssistantPage projectId={project?._id} activity={(job?.logs||[]).map((l:any,i:number)=>({_id:job._id+":"+i,createdAt:l.at||job.updatedAt,level:l.stage==="error"?"failure":"processing",stepKey:l.stage,message:l.message}))}/></aside></section>;
}
