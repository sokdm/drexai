import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
export function PlatformStatus({ children }: { children: ReactNode }) {
  const location = useLocation(), [status, setStatus] = useState<any>(null);
  const load = () => api("/api/platform-status").then(setStatus).catch(() => {});
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); return () => clearInterval(timer); }, [location.pathname]);
  if (status?.maintenance && !location.pathname.startsWith("/admin")) return <main className="maintenance-screen"><span>Drex</span><h1>We’ll be back shortly</h1><p>{status.message}</p><button onClick={() => void load()}>Check again</button><Link to="/admin/login">Administrator sign in</Link></main>;
  return <>{children}</>;
}
