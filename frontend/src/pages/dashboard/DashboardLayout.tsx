import { LiveCredits } from "../../components/LiveCredits";
import { NotificationBell } from "../../components/NotificationBell";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { NavLinkRenderProps } from "react-router-dom";
import { BrandMark } from "../../components/layout/BrandMark";
import { ThemeToggle } from "../../components/ui/ThemeToggle";
import { dashboardItems } from "../../config/navigation";
import { OnboardingTour } from "../../components/OnboardingTour";
import { useAuth } from "../../lib/auth";

export function DashboardLayout() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeTool = dashboardItems.find(({ path }) => path !== "/dashboard" && (pathname === path || pathname.startsWith(`${path}/`)));
  const standalone = activeTool && ["/dashboard/youtube-research", "/dashboard/voice-studio"].includes(activeTool.path);

  if (activeTool?.path === "/dashboard/video-editor") return <div className="feature-workspace reference-editor-shell"><main className="workspace-editor-content"><Outlet /></main><OnboardingTour /></div>;

  if (activeTool) {
    const Icon = activeTool.icon;
    return (
      <div className="feature-workspace min-h-screen bg-cloud text-ink dark:bg-slate-950 dark:text-white">
        <header className="workspace-toolbar sticky top-0 z-50 flex h-16 items-center gap-3 border-b border-line bg-white px-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          <Link to="/dashboard" title="Back to dashboard" aria-label="Back to dashboard" className="focus-ring hidden h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 sm:grid"><ArrowLeft size={19} /></Link>
          <Icon size={20} className="shrink-0 text-brand dark:text-brand-dark" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold sm:text-base">{activeTool.label}</span>
          <select aria-label="Switch workspace" value={activeTool.path} onChange={(event) => navigate(event.target.value)} className="focus-ring h-10 w-28 min-w-0 rounded-md border border-line bg-transparent px-2 text-sm dark:border-slate-700 sm:w-48">
            {dashboardItems.map(({ label, path }) => <option key={path} value={path}>{label}</option>)}
          </select>
          <LiveCredits /><NotificationBell /><div className="hidden sm:block"><ThemeToggle /></div>
          <Link to="/dashboard" title="Close workspace" aria-label="Close workspace" className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"><X size={20} /></Link>
        </header>
        <main className={standalone ? "workspace-standalone" : "workspace-content mx-auto w-full max-w-[1920px] p-4 lg:p-6"}><Outlet /></main>
        <OnboardingTour />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cloud text-ink dark:bg-slate-950 dark:text-white">
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:hidden"><button title="Open navigation" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu /></button><BrandMark /><LiveCredits /><NotificationBell /><ThemeToggle /></div>
      {open && <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}
      <aside className={(open ? "fixed" : "hidden") + " inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-line bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:fixed lg:block"}>
        <div className="mb-5 flex items-center justify-between"><BrandMark /><button className="lg:hidden" title="Close navigation" aria-label="Close navigation" onClick={() => setOpen(false)}><X /></button></div>
        <nav className="space-y-1">{dashboardItems.map(({ label, path, icon: Icon }) => <NavLink end={path === "/dashboard"} to={path} onClick={() => setOpen(false)} className={({ isActive }: NavLinkRenderProps) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold ${isActive ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`} key={path}><Icon size={17} />{label}</NavLink>)}</nav>
      </aside>
      <main className="lg:pl-64">
        <header className="hidden items-center justify-between border-b border-line bg-white px-8 py-4 dark:border-slate-800 dark:bg-slate-900 lg:flex"><h1 className="text-xl font-bold">Drex workspace</h1><div className="flex items-center gap-3"><LiveCredits /><NotificationBell /><ThemeToggle /><Link to="/dashboard/settings" className="rounded-md border border-line px-3 py-2 text-sm font-semibold dark:border-slate-700">{user?.displayName ?? "Account"}</Link></div></header>
        <div className="p-4 md:p-6"><Outlet /></div>
      </main>
      <OnboardingTour />
    </div>
  );
}
