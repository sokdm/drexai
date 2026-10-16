import { FormEvent, useEffect, useRef, useState } from "react";
import { Bookmark, Check, Copy, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { emptyNiche, nicheCategories, nicheFormats, nicheTemplates } from "../../config/niches";
import type { NicheDraft, NicheTemplate, SavedNiche } from "../../config/niches";

const inputClass = "focus-ring h-11 w-full rounded-md border border-line bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900";
export function NichesPage() {
  const [niches, setNiches] = useState<SavedNiche[]>([]);
  const [tab, setTab] = useState<"discover" | "saved">("discover");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [format, setFormat] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<NicheDraft>(emptyNiche);
  const [editing, setEditing] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  async function load() { const data = await api<{ niches: SavedNiche[] }>("/api/ai/niches"); setNiches(data.niches); }
  useEffect(() => { load().catch((err) => setError(err.message)).finally(() => setLoading(false)); }, []);

  function openEditor(niche?: NicheTemplate | SavedNiche) {
    setEditing(niche && "_id" in niche ? niche._id : null);
    setDraft(Object.fromEntries(Object.entries(emptyNiche).map(([key, value]) => [key, niche?.[key as keyof NicheDraft] ?? value])) as NicheDraft);
    setError(""); setNotice(""); dialog.current?.showModal();
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api(editing ? `/api/ai/niches/${editing}` : "/api/ai/niches", { method: editing ? "PATCH" : "POST", body: JSON.stringify(draft) });
      await load(); dialog.current?.close(); setTab("saved");
      setSearch(""); setCategory(""); setFormat(""); setNotice(editing ? "Niche updated." : "Niche saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save niche"); }
    finally { setBusy(false); }
  }
  async function act(niche: SavedNiche, action: "select" | "duplicate" | "delete") {
    if (action === "delete" && !window.confirm(`Delete "${niche.name}" from your saved niches?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/ai/niches/${niche._id}${action === "delete" ? "" : "/" + action}`, { method: action === "delete" ? "DELETE" : "POST", body: action === "delete" ? undefined : "{}" });
      await load(); setNotice(action === "select" ? "Active niche updated." : action === "duplicate" ? "Niche duplicated." : "Niche deleted.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update niche"); }
    finally { setBusy(false); }
  }
  const source: (NicheTemplate | SavedNiche)[] = tab === "discover" ? nicheTemplates : niches;
  const categories = [...new Set([...nicheCategories, ...niches.map(n => n.category).filter(Boolean)])].sort();
  const visible = source.filter(n => (!category || n.category === category) && (!format || n.contentStyle === format) && [n.name, n.category, n.description, n.audience, n.contentStyle].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
  const selected = niches.find(n => n.selected);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5 dark:border-slate-800">
      <div><h1 className="text-2xl font-bold">My Niches</h1><p className="mt-2 text-sm text-slate-500">{selected ? `Active niche: ${selected.name}` : "No active niche selected"}</p></div>
      <Button onClick={() => openEditor()}><Plus size={17} />Create niche</Button>
    </div>
    <div className="flex gap-5 border-b border-line dark:border-slate-800" role="tablist" aria-label="Niche views">
      {(["discover", "saved"] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setSearch(""); setCategory(""); setFormat(""); }} className={`focus-ring flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold ${tab === value ? "border-brand text-brand dark:text-brand-dark" : "border-transparent text-slate-500"}`}>{value === "discover" ? <Sparkles size={16} /> : <Bookmark size={16} />}{value === "discover" ? "Browse niche ideas" : `Saved niches (${niches.length})`}</button>)}
    </div>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_200px]">
      <label className="relative"><span className="sr-only">Search niches</span><Search size={17} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search niches, topics, or audiences" className={inputClass + " pl-10"} /></label>
      <select aria-label="Niche category" className={inputClass} value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Content format" className={inputClass} value={format} onChange={e => setFormat(e.target.value)}><option value="">All formats</option>{nicheFormats.map(value => <option key={value}>{value}</option>)}</select>
    </div>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    <p className="text-sm text-slate-500">{visible.length} {tab === "discover" ? "starter ideas" : "saved niches"}</p>
    {loading && tab === "saved" ? <p role="status">Loading niches...</p> : <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {visible.map(niche => {
        const saved = "_id" in niche;
        return <article key={saved ? niche._id : niche.id} className="flex min-w-0 flex-col rounded-lg border border-line bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold text-teal-700 dark:text-teal-300">{niche.category || "Custom"}</span>{saved && niche.selected && <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300"><Check size={13} />Active</span>}</div>
          <h2 className="mt-3 text-lg font-bold">{niche.name}</h2>
          <p className="mt-2 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{niche.description || "No description yet."}</p>
          <p className="mt-4 text-xs text-slate-500">{niche.contentStyle || "Custom format"} / {niche.preferredVideoDuration || "Flexible duration"}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 dark:border-slate-800">
            {saved ? <><Button disabled={busy || niche.selected} onClick={() => act(niche, "select")}><Check size={15} />{niche.selected ? "Selected" : "Select"}</Button><Button variant="ghost" title="Edit niche" aria-label={`Edit ${niche.name}`} onClick={() => openEditor(niche)}><Pencil size={16} /></Button><Button variant="ghost" disabled={busy} title="Duplicate niche" aria-label={`Duplicate ${niche.name}`} onClick={() => act(niche, "duplicate")}><Copy size={16} /></Button><Button variant="ghost" disabled={busy} title="Delete niche" aria-label={`Delete ${niche.name}`} onClick={() => act(niche, "delete")}><Trash2 size={16} /></Button></> : <Button variant="secondary" onClick={() => openEditor(niche)}><Plus size={16} />Use idea</Button>}
          </div>
        </article>;
      })}
    </div>}
    {!loading && visible.length === 0 && <div className="py-12 text-center"><h2 className="text-lg font-semibold">{tab === "saved" && !niches.length ? "No saved niches yet" : "No matching niches"}</h2><Button className="mt-4" variant="secondary" onClick={() => { setSearch(""); setCategory(""); setFormat(""); if (!niches.length) setTab("discover"); }}>Browse all niches</Button></div>}
    <dialog ref={dialog} aria-labelledby="niche-editor-title" onCancel={event => { if (busy) event.preventDefault(); }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl rounded-lg border border-line bg-white p-0 text-ink backdrop:bg-black/50 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
      <form onSubmit={save}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h2 id="niche-editor-title" className="text-lg font-bold">{editing ? "Edit niche" : "Create niche"}</h2><button type="button" disabled={busy} title="Close niche editor" aria-label="Close niche editor" className="focus-ring grid h-9 w-9 place-items-center rounded-md" onClick={() => dialog.current?.close()}><X size={20} /></button></header>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <label className="text-sm font-semibold sm:col-span-2">Name<input autoFocus required maxLength={120} className={inputClass + " mt-2"} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="text-sm font-semibold sm:col-span-2">Description<textarea maxLength={3000} className={inputClass + " mt-2 h-24 py-3"} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <label className="text-sm font-semibold">Category<input list="niche-categories" maxLength={100} className={inputClass + " mt-2"} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /><datalist id="niche-categories">{categories.map(value => <option key={value} value={value} />)}</datalist></label>
          <label className="text-sm font-semibold">Content format<input list="niche-formats" maxLength={100} className={inputClass + " mt-2"} value={draft.contentStyle} onChange={e => setDraft({ ...draft, contentStyle: e.target.value })} /><datalist id="niche-formats">{nicheFormats.map(value => <option key={value} value={value} />)}</datalist></label>
          {(["audience", "language", "preferredVideoDuration", "visualStyle", "storytellingStyle"] as const).map(key => <label className="text-sm font-semibold" key={key}>{{ audience: "Audience", language: "Language", preferredVideoDuration: "Preferred duration", visualStyle: "Visual style", storytellingStyle: "Storytelling style" }[key]}<input maxLength={200} className={inputClass + " mt-2"} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><Button type="button" variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</Button><Button disabled={busy || !draft.name.trim()}>{busy ? "Saving..." : "Save niche"}</Button></footer>
      </form>
    </dialog>
  </div>;
}
