import { useRealtime } from "../../lib/realtime";
import { useEffect, useState } from "react";
import { Coins, ReceiptText, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Loader } from "../../components/ui/Loader";
import { api } from "../../lib/api";

export function WalletPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setError("");
    try {
      const result = await api("/api/wallet");
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load wallet");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); const refresh = () => { if (!document.hidden) void load(); }; window.addEventListener("focus", refresh); const timer = setInterval(refresh, 30000); return () => { window.removeEventListener("focus", refresh); clearInterval(timer); }; }, []);
  useRealtime({ "notifications:changed": () => { void load(); }, connect: () => { void load(); } });
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const txRef = params.get("tx_ref");
    const transactionId = params.get("transaction_id");
    if (!txRef) return;
    api("/api/wallet/payments/verify", { method: "POST", body: JSON.stringify({ txRef, transactionId: transactionId ?? undefined }) })
      .then(() => load())
      .catch((err) => setError(err instanceof Error ? err.message : "Payment verification is pending"));
  }, []);

  async function buy(packageId: string) {
    setError("");
    try {
      const result = await api<{ checkoutUrl: string }>("/api/wallet/payments/initiate", { method: "POST", body: JSON.stringify({ packageId }) });
      location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    }
  }

  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Loader label="Loading credit wallet" /></div>;

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div><p className="text-sm font-bold text-brand dark:text-brand-dark">Pay as you go</p><h2 className="mt-2 text-3xl font-black">Credit Wallet</h2><button type="button" className="mt-2 text-sm text-brand" onClick={() => void load()}>Refresh balance</button><p className="mt-2 text-slate-600 dark:text-slate-300">Your balance includes verified purchases and documented administrator adjustments.</p></div>
          <div className="rounded-md bg-cloud p-5 dark:bg-slate-950"><Coins className="mb-3 text-brand" /><p className="text-4xl font-black">{data?.wallet?.availableCredits ?? 0}</p><p className="text-sm text-slate-500">available credits</p></div>
        </div>
        {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {data?.packages?.map((pkg: any) => <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900" key={pkg._id}><h3 className="text-xl font-black">{pkg.name}</h3><p className="mt-3 text-4xl font-black">{pkg.currency} {pkg.amount}</p><p className="mt-2 text-slate-600 dark:text-slate-300">{pkg.credits.toLocaleString()} credits</p>{pkg.promotion && <p className="mt-2 text-sm">{pkg.promotion}</p>}<Button className="mt-6" onClick={() => buy(pkg._id)}>Buy Credits</Button></div>)}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <History title="Purchase history" icon={<ReceiptText />} rows={data?.payments ?? []} empty="No purchases yet." />
        <History title="Credit ledger" icon={<ShieldCheck />} rows={data?.ledger ?? []} empty="No wallet activity yet." />
      </section>
    </div>
  );
}

function History({ title, rows, empty, icon }: { title: string; rows: any[]; empty: string; icon: JSX.Element }) {
  return <div className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-3 font-black">{icon}{title}</div><div className="mt-4 space-y-3">{rows.length === 0 && <p className="text-sm text-slate-500">{empty}</p>}{rows.map((row) => <div className="rounded-md border border-line p-3 text-sm dark:border-slate-700" key={row._id}><strong>{row.type ?? row.status}</strong><br /><span className="text-slate-500">{new Date(row.createdAt).toLocaleString()}</span><pre className="mt-2 overflow-auto text-xs text-slate-500">{JSON.stringify(row.receipt ?? row.metadata ?? {}, null, 2).slice(0, 500)}</pre></div>)}</div></div>;
}
