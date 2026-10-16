import { useEffect } from "react";
import { api } from "./api";

// Quoting is non-billable. A separate Generate action always authorizes execution.
export function useAutomaticQuote(path: string, settings: any, enabled: boolean, setQuote: (quote: any) => void, setError: (message: string) => void) {
 const serialized = JSON.stringify(settings);
 useEffect(() => {
  if (!enabled || !settings.model?.startsWith("openrouter/")) return;
  let active = true;
  const timer = setTimeout(() => {
   api<any>(path, { method: "POST", body: serialized }).then(data => { if (active) { setQuote(data.quote); setError(""); } }).catch(error => { if (active) { setQuote(null); setError(error.message); } });
  }, 650);
  return () => { active = false; clearTimeout(timer); };
 }, [path, serialized, enabled]);
}
