import { useState } from "react";
import { Button } from "./ui/Button";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

const steps = [
  ["Dashboard navigation", "Use the sidebar to move through the Drex production workspace."],
  ["YouTube research", "Research pages will later surface channels, niches, and opportunity signals."],
  ["AI tools", "Script, image, video, and voice tools are already mapped in the interface."],
  ["AI Studio", "The studio will coordinate complete scene-by-scene production."],
  ["Credits", "Credit wallet features arrive later, after authentication is stable."],
  ["Projects", "Projects will hold research, scripts, media, and exports."],
  ["Support", "Support and feedback routes are available from the dashboard."]
];

export function OnboardingTour() {
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(user?.onboarding?.step ?? 0);
  if (!user || user.onboarding?.completed || user.onboarding?.skipped) return null;
  const [title, text] = steps[step];

  async function save(payload: Record<string, unknown>) {
    await api("/api/account/onboarding", { method: "PATCH", body: JSON.stringify(payload) });
    await refresh();
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-md border border-line bg-white p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-bold text-brand dark:text-brand-dark">Step {step + 1} of {steps.length}</p>
        <h2 className="mt-2 text-2xl font-black">{title}</h2>
        <p className="mt-3 text-slate-600 dark:text-slate-300">{text}</p>
        <div className="mt-6 flex flex-wrap justify-between gap-3">
          <Button variant="ghost" onClick={() => save({ skipped: true })}>Skip</Button>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button>
            {step < steps.length - 1 ? <Button onClick={() => { const next = step + 1; setStep(next); void save({ step: next }); }}>Next</Button> : <Button onClick={() => save({ completed: true, step })}>Finish</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
