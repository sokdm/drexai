import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Coins } from "lucide-react";
import { api } from "../lib/api";
import { useRealtime } from "../lib/realtime";
export function LiveCredits() {
 const [balance, setBalance] = useState<number | null>(null);
 const load = () => { void api<any>("/api/wallet").then(d => setBalance(d.wallet?.availableCredits ?? d.availableCredits ?? null)).catch(() => {}); };
 useEffect(() => { load(); const timer = setInterval(load, 15000); window.addEventListener("focus", load); window.addEventListener("wallet:refresh", load); return () => { clearInterval(timer); window.removeEventListener("focus", load); window.removeEventListener("wallet:refresh", load); }; }, []);
 useRealtime({ "notifications:changed": load, connect: load });
 return <Link className="live-credits" to="/dashboard/credit-wallet" title="Available wallet credits"><Coins size={15} /><span>{balance === null ? "Wallet" : `${balance.toLocaleString()} credits`}</span></Link>;
}
