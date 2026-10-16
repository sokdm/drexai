import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Clapperboard, PenLine, Plus } from "lucide-react";
import { api } from "../../lib/api";

export function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<any>("/api/ai/projects").then(d => setProjects(d.projects)).catch(err => setError(err.message)).finally(() => setLoading(false)); }, []);
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5 dark:border-slate-800"><h1 className="text-2xl font-bold">Projects</h1><Link className="focus-ring inline-flex items-center gap-2 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white" to="/dashboard/script-builder"><Plus size={17} />Create script project</Link></header>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {loading ? <p role="status">Loading projects...</p> : !projects.length ? <p className="py-8 text-slate-500">No projects yet.</p> : <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map(project => <article className="rounded-md border border-line bg-white p-5 dark:border-slate-800 dark:bg-slate-900" key={project._id}>
      <h2 className="text-lg font-bold">{project.title}</h2><p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{project.summary}</p><p className="mt-4 text-xs text-slate-500">{project.scenes?.length ?? 0} scenes / {project.approvedAt ? "Approved" : "Draft"}</p>
      <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-brand dark:text-brand-dark"><Link className="focus-ring flex items-center gap-2" to={`/dashboard/script-builder?projectId=${project._id}`}><PenLine size={16} />Open script</Link>{project.approvedAt && <Link className="focus-ring flex items-center gap-2" to={`/dashboard/ai-studio?projectId=${project._id}${project.latestProductionId ? `&productionId=${project.latestProductionId}` : ""}`}><Clapperboard size={16} />Open Studio</Link>}</div>
      {(project.latestEditId || project.latestProductionId) && <Link className="focus-ring mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand dark:text-brand-dark" to={`/dashboard/video-editor?${project.latestEditId ? `editId=${project.latestEditId}` : `productionId=${project.latestProductionId}`}`}><Clapperboard size={16} />{project.finalExportId ? "Open finished video & re-edit" : "Continue editing"}</Link>}
    </article>)}</section>}
  </div>;
}
