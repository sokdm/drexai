import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
export function PlatformStatus({ children }: { children: ReactNode }) {
  const location = useLocation(), [status, setStatus] = useState<any>(null);
  const load = () => api("/api/platform-status").then(setStatus).catch(() => {});
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); return () => clearInterval(timer); }, [location.pathname]);
  useEffect(() => { if (!status?.website) return; document.title = status.website.siteName; const meta = document.querySelector('meta[name="description"]'); meta?.setAttribute("content", status.website.description); }, [status?.website?.siteName, status?.website?.description]);
  if (status?.maintenance && !location.pathname.startsWith("/admin")) return <main className="maintenance-screen"><span>{status.website?.siteName || "Drex"}</span><h1>We’ll be back shortly</h1><p>{status.message}</p><button onClick={() => void load()}>Check again</button>{status.website?.supportEmail && <a href={"mailto:" + status.website.supportEmail}>Contact support</a>}<Link to="/admin/login">Administrator sign in</Link></main>;
  return <>{children}</>;
}
