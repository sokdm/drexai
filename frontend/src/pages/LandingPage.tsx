import {formatPackagePrice} from "../lib/money";
import { brand } from "@drex/shared";
import { BookOpenText, Bot, Check, ChevronRight, Image, Menu, Mic, Play, Search, Sparkles, Video, X } from "lucide-react";
import { api } from "../lib/api";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "../components/layout/BrandMark";
import { Button } from "../components/ui/Button";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { Loader } from "../components/ui/Loader";

const nav = ["Home", "Features", "How It Works", "Credit Pricing", "FAQ", "Contact"];
const features = [
  ["Advanced YouTube research", Search], ["AI channel analysis", Bot], ["Niche discovery", Sparkles],
  ["AI script and story writing", BookOpenText], ["Text-to-image generation", Image], ["Image-to-video generation", Video],
  ["AI voiceovers", Mic], ["Intelligent AI Studio", Play], ["Video editing", Check], ["Content publishing assistance", ChevronRight]
];
const workflow = ["Research", "Choose Niche", "Generate Story", "Create Images", "Generate Video", "Edit", "Export"];

export function LandingPage() {
  const [creditPackages, setCreditPackages] = useState<any[]>([]);
  useEffect(() => { api<any>("/api/wallet/packages").then(d => setCreditPackages(d.packages || [])).catch(() => {}); }, []);
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-cloud text-ink dark:bg-slate-950 dark:text-white">
      <header className="sticky top-0 z-50 border-b border-line bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link to="/"><BrandMark /></Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300 lg:flex">
            {nav.map((item) => <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`} className="hover:text-brand">{item}</a>)}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <ThemeToggle /><Link to="/login"><Button variant="ghost">Login</Button></Link><Link to="/signup"><Button>Sign Up</Button></Link>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(!open)} aria-label="Open menu">{open ? <X /> : <Menu />}</button>
        </div>
        {open && <div className="border-t border-line bg-white p-4 dark:border-slate-800 dark:bg-slate-950 lg:hidden">{nav.map((item) => <a className="block py-3" href={`#${item.toLowerCase().replaceAll(" ", "-")}`} key={item}>{item}</a>)}<div className="mt-2 flex gap-2"><ThemeToggle /><Link to="/login"><Button variant="secondary">Login</Button></Link><Link to="/signup"><Button>Sign Up</Button></Link></div></div>}
      </header>

      <main>
        <section id="home" className="relative overflow-hidden border-b border-line dark:border-slate-800">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:py-24 lg:grid-cols-[1fr_0.95fr] lg:items-center">
            <div className="animate-rise">
              <p className="mb-4 inline-flex rounded-md border border-brand/20 bg-brand-soft px-3 py-1 text-sm font-semibold text-brand dark:bg-blue-950 dark:text-brand-dark">YouTube automation command center</p>
              <h1 className="max-w-3xl text-4xl font-black leading-tight md:text-6xl">{brand.name}</h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-650 dark:text-slate-300">Research content opportunities, create scripts, generate images, animate scenes, produce voiceovers, and plan complete videos through one connected AI workspace.</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link to="/signup"><Button className="w-full sm:w-auto">Start with credits <ChevronRight size={18} /></Button></Link><Link to="/dashboard"><Button variant="secondary" className="w-full sm:w-auto"><Play size={18} /> View dashboard</Button></Link></div>
            </div>
            <div className="overflow-hidden rounded-md border border-line bg-white shadow-soft dark:border-slate-800 dark:bg-slate-900">
              <img src="/assets/drex-ai-workspace.png" alt="AI video production workspace preview" className="h-full w-full object-cover" />
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-4 py-16">
          <SectionTitle title="A serious workspace for content production" text="Phase 1 previews the workflows and surfaces without pretending the automation is live yet." />
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">{features.map(([label, Icon]) => <div className="rounded-md border border-line bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" key={label as string}><Icon className="mb-5 text-brand dark:text-brand-dark" /><h3 className="font-bold">{label as string}</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Polished preview state ready for future production logic.</p></div>)}</div>
        </section>

        <section id="how-it-works" className="border-y border-line bg-white py-16 dark:border-slate-800 dark:bg-slate-900/45">
          <div className="mx-auto max-w-7xl px-4"><SectionTitle title="Workflow" text="Research to export, organized as a connected production pipeline." /><div className="grid gap-3 md:grid-cols-7">{workflow.map((step, index) => <div className="rounded-md border border-line bg-cloud p-4 text-sm font-bold dark:border-slate-700 dark:bg-slate-950" key={step}><span className="mb-3 block text-xs text-brand">0{index + 1}</span>{step}</div>)}</div></div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <SectionTitle title="AI Studio preview" text="A future agent will coordinate research, scripts, scenes, voiceovers, editing, and export from one production room." />
          <StudioPreview />
        </section>

        <section className="border-y border-line bg-white py-16 dark:border-slate-800 dark:bg-slate-900/45">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 lg:grid-cols-3">
            <div className="overflow-hidden rounded-md border border-line bg-cloud dark:border-slate-700 dark:bg-slate-950 lg:col-span-2"><img src="/assets/drex-ai-references.png" alt="AI content reference boards for scripts, thumbnails, scenes, and voiceover" className="h-full w-full object-cover" /></div>
            <div className="rounded-md border border-line bg-cloud p-6 dark:border-slate-700 dark:bg-slate-950"><h3 className="text-2xl font-black">Image references built into the workflow</h3><p className="mt-3 text-slate-600 dark:text-slate-300">Drex now shows how generated thumbnails, prompt cards, scene boards, and voiceover references will live beside the production timeline.</p><div className="mt-6 space-y-3">{["Thumbnail direction", "Scene mood boards", "Voice waveform reference"].map((item) => <div className="rounded-md bg-white p-3 text-sm font-bold dark:bg-slate-900" key={item}>{item}</div>)}</div></div>
          </div>
        </section>

        <section id="credit-pricing" className="border-y border-line bg-white py-16 dark:border-slate-800 dark:bg-slate-900/45">
          <div className="mx-auto max-w-7xl px-4"><SectionTitle title="Credit pricing" text="Pay as you go with no mandatory monthly subscription. Choose a credit package and approve each paid generation before it starts." /><div className="grid gap-4 md:grid-cols-2">{creditPackages.map((pkg) => <div className="rounded-md border border-line p-6 dark:border-slate-700" key={pkg._id}><h3 className="text-xl font-black">{pkg.name}</h3><p className="mt-3 text-4xl font-black">{formatPackagePrice(pkg.amount,pkg.currency)}</p><p className="mt-2 text-slate-600 dark:text-slate-300">{pkg.credits.toLocaleString()} credits</p><p>{pkg.promotion}</p><Link to="/dashboard/credit-wallet" className="mt-6 inline-block">Choose package</Link></div>)}</div></div>
        </section>

        <section id="faq" className="mx-auto max-w-4xl px-4 py-16"><SectionTitle title="FAQ" text="Clear expectations for Phase 1." />{["Are AI generation tools live?", "Is this a subscription?", "Can the brand change later?"].map((q) => <details className="mb-3 rounded-md border border-line bg-white p-5 dark:border-slate-800 dark:bg-slate-900" key={q}><summary className="cursor-pointer font-bold">{q}</summary><p className="mt-3 text-slate-600 dark:text-slate-300">This phase builds the professional foundation and UI. Production integrations arrive in later phases.</p></details>)}</section>
        <section id="contact" className="border-t border-line px-4 py-16 text-center dark:border-slate-800"><h2 className="text-3xl font-black">Ready to plan smarter videos?</h2><p className="mt-3 text-slate-600 dark:text-slate-300">{brand.supportEmail}</p></section>
      </main>
      <footer className="border-t border-line px-4 py-8 dark:border-slate-800"><div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between"><BrandMark /><span>Privacy Policy · Terms · Support · Social</span></div></footer>
    </div>
  );
}

function SectionTitle({ title, text }: { title: string; text: string }) {
  return <div className="mb-8"><h2 className="text-3xl font-black md:text-4xl">{title}</h2><p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{text}</p></div>;
}

function ProductPreview() {
  return <div className="rounded-md border border-line bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-slate-900"><div className="grid gap-3 md:grid-cols-[1fr_0.75fr]"><div className="rounded-md bg-slate-950 p-5 text-white"><p className="text-sm text-brand-dark">Opportunity score</p><p className="mt-4 text-5xl font-black">87</p><div className="mt-8 h-36 rounded bg-gradient-to-br from-blue-500 via-teal-400 to-amber-300" /></div><div className="space-y-3">{["Script outline", "Scene prompts", "Voiceover queue", "Export checklist"].map((item) => <div className="rounded-md border border-line p-4 text-sm font-bold dark:border-slate-700" key={item}>{item}</div>)}</div></div></div>;
}

function StudioPreview() {
  return <div className="rounded-md border border-line bg-white p-4 shadow-soft dark:border-slate-800 dark:bg-slate-900"><div className="aspect-video rounded-md bg-slate-950 p-5 text-white"><div className="flex h-full flex-col items-center justify-center rounded border border-white/10"><Loader label="AI scene engine warming up" /><Play className="mt-4 opacity-60" /></div></div><div className="mt-4 grid gap-3 md:grid-cols-3">{["Scene 01 queued", "Voice pass pending", "Render log clean"].map((item) => <div className="rounded-md bg-cloud p-3 text-sm dark:bg-slate-950" key={item}>{item}</div>)}</div></div>;
}
