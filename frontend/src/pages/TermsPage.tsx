import { Link } from "react-router-dom";
import { BrandMark } from "../components/layout/BrandMark";
import { Button } from "../components/ui/Button";
import { ThemeToggle } from "../components/ui/ThemeToggle";

export function TermsPage() {
  return (
    <div className="min-h-screen bg-cloud px-4 py-8 text-ink dark:bg-slate-950 dark:text-white">
      <header className="mx-auto flex max-w-4xl items-center justify-between"><Link to="/"><BrandMark /></Link><ThemeToggle /></header>
      <main className="mx-auto mt-8 max-w-4xl rounded-md border border-line bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900 md:p-10">
        <p className="text-sm font-bold text-brand dark:text-brand-dark">Drex legal</p>
        <h1 className="mt-2 text-4xl font-black">Terms of Service</h1>
        <p className="mt-4 text-slate-600 dark:text-slate-300">These development terms define the rules for using the Drex beta workspace.</p>
        {[
          ["Account responsibility", "You are responsible for the accuracy of your signup details and for keeping your login credentials secure."],
          ["Acceptable use", "Do not use Drex to create, store, or distribute unlawful, harmful, deceptive, or rights-infringing content."],
          ["Credits and payments", "Drex uses pay-as-you-go credits. Credits are granted only after backend payment verification. Live payments remain disabled until production approval."],
          ["YouTube and Google data", "Connected Google data is used only for features you request. Private analytics are shown only for your authorized channel."],
          ["Beta limitations", "Some tools are previews or later-phase features. Drex may change, pause, or remove beta functionality during development."],
          ["Termination", "Accounts may be suspended for misuse, attempted abuse, or security risk."],
          ["Contact", "For support, contact the address shown in the app footer or settings area."]
        ].map(([title, text]) => (
          <section className="mt-8" key={title}>
            <h2 className="text-xl font-black">{title}</h2>
            <p className="mt-2 leading-7 text-slate-600 dark:text-slate-300">{text}</p>
          </section>
        ))}
        <Link to="/signup"><Button className="mt-8">Back to signup</Button></Link>
      </main>
    </div>
  );
}
