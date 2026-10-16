import { creditPackages } from "@drex/shared";
import { ChevronRight, Coins, FolderPlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { quickTools } from "../../config/navigation";

export function DashboardHome() {
  return (
    <div className="space-y-6">
      <section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-brand dark:text-brand-dark">Welcome back</p>
        <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-3xl font-black">Build your next YouTube project</h2><p className="mt-2 text-slate-600 dark:text-slate-300">Use the workflow shell to move from research to export as features come online.</p></div>
          <Button><FolderPlus size={18} /> Create Project</Button>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-3"><Coins className="text-brand" /><h3 className="font-black">Credit balance</h3></div><p className="mt-5 text-5xl font-black">0</p><p className="mt-2 text-sm text-slate-500">Pricing packages: {creditPackages.map((p) => `${p.credits.toLocaleString()} credits`).join(" / ")}</p></div>
        <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-black">Quick access tools</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{quickTools.map(({ label, path, icon: Icon }) => <a href={path} className="flex items-center justify-between rounded-md border border-line p-4 text-sm font-bold hover:border-brand dark:border-slate-700" key={path}><span className="flex items-center gap-3"><Icon size={18} />{label}</span><ChevronRight size={16} /></a>)}</div></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {["Recent projects", "Recent activity", "Workflow"].map((title) => <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900" key={title}><h3 className="font-black">{title}</h3><p className="mt-4 text-sm text-slate-600 dark:text-slate-300">No production data yet. This Phase 1 surface is ready for real backend records later.</p></div>)}
      </div>
    </div>
  );
}
