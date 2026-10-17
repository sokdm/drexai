import { downloadMedia } from "../../lib/downloadMedia";
import { useEffect, useState } from "react";
import { Copy, Download, Film, ImageIcon, Loader2, RefreshCw, Trash2, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { api, API_URL } from "../../lib/api";

export const mediaUrl = (value?: string) => value?.startsWith("/api/") ? API_URL + value : value;

export function GenerationResults({ kind, assets, jobs, busy, onRefresh, onRegenerate, onDelete }: {
  kind: "image" | "video"; assets: any[]; jobs: any[]; busy?: boolean;
  onRefresh: () => void; onRegenerate: (asset: any) => void; onDelete: (asset: any) => void;
}) {
  const [tab, setTab] = useState("results");
  const [selectedId, setSelectedId] = useState("");
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = assets.find(asset => asset._id === selectedId) ?? assets[0];
  const active = jobs.find(job => ["queued", "processing", "retrying"].includes(job.status));
  const Icon = kind === "video" ? Film : ImageIcon;
  useEffect(() => {
    let alive = true; setNotice(""); setUrl(mediaUrl(selected?.url) ?? "");
    if (selected) api<{ url: string }>(`/api/${kind === "video" ? "videos" : "images"}/assets/${selected._id}/url`).then(data => { if (alive) setUrl(mediaUrl(data.url) ?? ""); }).catch(err => { if (alive) setNotice(err.message); });
    return () => { alive = false; };
  }, [selected?._id, kind]);
  return <main className="generation-results">
    <section aria-label="Result preview" className="result-preview">
      <header className="result-bar"><h2>{kind === "video" ? "Video preview" : "Image preview"}</h2><span className="result-state" role="status">{active ? <><Loader2 size={13} className="animate-spin" />{active.status}</> : selected ? "Completed" : "Ready"}</span></header>
      <div className={`preview-stage ${selected ? "has-output" : ""}`}>
        {selected && url ? kind === "video" ? <video key={selected._id} src={url} controls playsInline onError={() => setNotice("Preview unavailable. Refresh to renew the media link.")} /> : <img src={url} alt={selected.prompt || "Generated image"} /> : <div className="preview-empty">{active || busy ? <Loader2 size={30} className="animate-spin" /> : <Icon size={30} strokeWidth={1.25} />}<h3>{active ? "Generation in progress" : busy ? "Submitting request" : `No ${kind === "video" ? "video" : "image"} generated yet`}</h3><p>{active ? active.progress ? `${active.progress}%` : "Queued" : busy ? "Reviewing your request…" : `Your generated ${kind} will appear here. Preview and download it when ready.`}</p></div>}
      </div>
      {kind === "video" && selected?.metadata?.nativeAudio && <p className="px-4 py-2 text-xs text-slate-500">Native audio detected. Review dialogue, voices and mouth synchronization before using this clip. Regenerate uses a new cost approval.</p>}
      <footer className="result-bar"><span className="truncate text-xs text-slate-500">{selected ? `${selected.metadata?.name || (kind === "image" ? "Generated image" : "Generated clip")}${selected.durationSeconds ? ` / ${selected.durationSeconds}s` : ""}` : "Output preview"}</span>
        <div className="flex shrink-0 gap-1">{selected && <>
          <button type="button" disabled={downloading} className="tool-icon" title="Save to device" aria-label="Download result" onClick={async () => { setDownloading(true); setNotice(""); try { const extension = kind === "video" ? "mp4" : selected.contentType === "image/jpeg" ? "jpg" : selected.contentType === "image/webp" ? "webp" : "png"; await downloadMedia(`/api/${kind === "video" ? "videos" : "images"}/assets/${selected._id}/download`, `drex-${kind}-${selected._id}.${extension}`); setNotice("Download started."); } catch (error: any) { setNotice(error.message); } finally { setDownloading(false); } }}>{downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}</button>
          <button className="tool-icon" title="Copy prompt" aria-label="Copy prompt" onClick={() => navigator.clipboard.writeText(selected.prompt ?? "").then(() => setNotice("Prompt copied.")).catch(() => setNotice("Clipboard unavailable."))}><Copy size={16} /></button>
          <button className="tool-icon" title="Reuse settings" aria-label="Reuse settings" onClick={() => onRegenerate(selected)}><RefreshCw size={16} /></button>
          {kind === "image" && <Link className="tool-icon" title="Animate image" aria-label="Animate image" to={`/dashboard/image-to-video?imageId=${selected._id}`}><Video size={16} /></Link>}
          <button className="tool-icon" title="Delete result" aria-label="Delete result" onClick={() => onDelete(selected)}><Trash2 size={16} /></button>
        </>}</div>
      </footer>
    </section>
    {notice && <p role="status" className="text-xs text-slate-500">{notice}</p>}
    <section aria-label="Generation output" className="output-section">
      <header className="output-tabs"><div role="tablist" aria-label="Output views">{[["results", `Results (${assets.length})`], ["history", `History (${jobs.length})`]].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div><button className="tool-icon" title="Refresh results" aria-label="Refresh results" onClick={onRefresh}><RefreshCw size={15} /></button></header>
      {tab === "results" ? <div className="output-grid">{assets.map((asset, index) => <button key={asset._id} className={`output-tile ${selected?._id === asset._id ? "selected" : ""}`} onClick={() => setSelectedId(asset._id)} aria-label={`Preview ${kind} ${index + 1}`} aria-pressed={selected?._id === asset._id}>
        {kind === "image" ? <img src={mediaUrl(asset.url)} alt="" loading="lazy" /> : <video src={mediaUrl(asset.url)} muted preload="metadata" />}
        <span>{asset.metadata?.name || `${kind === "video" ? "Clip" : "Image"} ${assets.length - index}`}</span>
      </button>)}{!assets.length && <p className="output-empty">No saved {kind === "video" ? "clips" : "images"}.</p>}</div> : <div className="job-list">{jobs.map(job => <article key={job._id}>
        <div className="flex min-w-0 items-center gap-2"><span className={`job-dot ${job.status}`} /><strong className="capitalize">{job.status}</strong><time>{job.createdAt ? new Date(job.createdAt).toLocaleString() : ""}</time></div>
        <p>{job.prompt || job.motionPrompt}</p><div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{job.model}</span><span>{typeof job.outputMetadata?.creditsCharged === "number" ? `${job.outputMetadata.creditsCharged} credits charged` : `${job.approvedCredits ?? 0} credits approved`}</span></div>{job.error && <p className="text-red-600">{job.error}</p>}
      </article>)}{!jobs.length && <p className="output-empty">No generation history.</p>}</div>}
    </section>
  </main>;
}
