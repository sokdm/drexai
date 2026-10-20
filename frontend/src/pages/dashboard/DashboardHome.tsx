import {formatPackagePrice,formatCreditRate} from "../../lib/money";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/realtime";
import { ChevronRight, Coins, FolderPlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { quickTools } from "../../config/navigation";

export function DashboardHome() {
  const [wallet, setWallet] = useState<any>(null), [packages, setPackages] = useState<any[]>([]), [error, setError] = useState("");
  const refreshWallet = () => { void api<any>("/api/wallet").then(d => { setWallet(d.wallet); setPackages(d.packages || []); setError(""); }).catch(() => setError("Could not refresh your balance.")); };
  useEffect(() => { refreshWallet(); const refresh = () => { if (!document.hidden) refreshWallet(); }; window.addEventListener("focus", refresh); const timer = setInterval(refresh, 30000); return () => { window.removeEventListener("focus", refresh); clearInterval(timer); }; }, []);
  useRealtime({ "notifications:changed": refreshWallet, connect: refreshWallet });
  return (
    <div className="space-y-6">
      <section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-brand dark:text-brand-dark">Welcome back</p>
        <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-3xl font-black">Build your next YouTube project</h2><p className="mt-2 text-slate-600 dark:text-slate-300">Use the workflow shell to move from research to export as features come online.</p></div>
          <Link to="/dashboard/script-builder"><Button><FolderPlus size={18} /> Create Project</Button></Link>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-3"><Coins className="text-brand" /><h3 className="font-black">Credit balance</h3></div><p className="mt-5 text-5xl font-black" aria-label="Available credit balance">{wallet ? Number(wallet.availableCredits).toLocaleString() : "?"}</p>{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}<button className="mt-3 text-sm text-brand" onClick={refreshWallet}>Refresh balance</button> <Link className="ml-3 text-sm text-brand" to="/dashboard/credit-wallet">Open wallet</Link><p className="mt-2 text-sm text-slate-500">Pricing packages: {packages.map((p) => `${formatPackagePrice(p.amount,p.currency)} for ${p.credits.toLocaleString()} credits`).join(" / ")}</p></div>
        <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-black">Quick access tools</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{quickTools.map(({ label, path, icon: Icon }) => <a href={path} className="flex items-center justify-between rounded-md border border-line p-4 text-sm font-bold hover:border-brand dark:border-slate-700" key={path}><span className="flex items-center gap-3"><Icon size={18} />{label}</span><ChevronRight size={16} /></a>)}</div></div>
      </div>
      <section aria-label="Credit packages"><h3 className="text-xl font-black">Credit packages</h3><p className="mt-1 text-sm text-slate-500">One-time purchases. Paid generations show a credit quote before approval.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{packages.map(p=><article key={p._id} className="rounded-3xl border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h4 className="font-bold">{p.name}</h4><p className="mt-3 text-3xl font-black">{formatPackagePrice(p.amount,p.currency)}</p><p className="mt-6 text-3xl font-bold">{Number(p.credits).toLocaleString()}</p><p className="mt-1 text-slate-500">credits</p><p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{formatCreditRate(p.amount,p.credits,p.currency)} per credit</p>{p.promotion&&<p className="mt-6 border-t border-line pt-4 dark:border-slate-700">{p.promotion}</p>}<Link className="mt-4 inline-block font-semibold text-brand" to="/dashboard/credit-wallet">Buy credits</Link></article>)}</div></section>
      <div className="grid gap-6 lg:grid-cols-3">
        {["Recent projects", "Recent activity", "Workflow"].map((title) => <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900" key={title}><h3 className="font-black">{title}</h3><p className="mt-4 text-sm text-slate-600 dark:text-slate-300">No production data yet. This Phase 1 surface is ready for real backend records later.</p></div>)}
      </div>
    </div>
  );
}
