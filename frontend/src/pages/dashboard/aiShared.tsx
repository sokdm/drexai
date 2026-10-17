import { api } from "../../lib/api";

export async function quote(feature: string) {
  const data = await api<{ quote: { allowed: boolean; credits: number; reason?: string } }>("/api/ai/quote", { method: "POST", body: JSON.stringify({ feature }) });
  if (!data.quote.allowed) throw new Error(data.quote.reason ?? "Pricing unavailable");
  if (!window.confirm(`Approve a maximum of ${data.quote.credits} credits for this AI operation? Verified lower usage on eligible OpenRouter quotes releases unused credits.`)) throw new Error("Generation cancelled before any paid request.");
  return data.quote.credits;
}

export function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block text-sm font-semibold">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-line bg-transparent px-3 dark:border-slate-700" /></label>;
}

export function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-semibold">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-28 w-full rounded-md border border-line bg-transparent p-3 dark:border-slate-700" /></label>;
}
