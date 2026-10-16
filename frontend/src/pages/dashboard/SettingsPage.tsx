import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [profile, setProfile] = useState({ displayName: user?.displayName ?? "", profilePictureUrl: user?.profilePictureUrl ?? "", appearance: user?.preferences?.appearance ?? "system" });
  const [passwords, setPasswords] = useState({ currentPassword: "", password: "", confirmPassword: "" });

  useEffect(() => { api<{ sessions: any[] }>("/api/account/sessions").then((data) => setSessions(data.sessions)).catch(() => null); }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const data = await api("/api/account/profile", { method: "PATCH", body: JSON.stringify({ displayName: profile.displayName, profilePictureUrl: profile.profilePictureUrl, preferences: { appearance: profile.appearance } }) });
    setMessage("Profile updated");
    await refresh();
    return data;
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    await api("/api/account/password", { method: "PATCH", body: JSON.stringify(passwords) });
    setPasswords({ currentPassword: "", password: "", confirmPassword: "" });
    setMessage("Password changed");
  }

  async function restartTour() {
    await api("/api/account/onboarding", { method: "PATCH", body: JSON.stringify({ restart: true }) });
    await refresh();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-2xl font-black">Account settings</h2>
        {message && <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">{message}</p>}
        <form className="mt-6 space-y-4" onSubmit={saveProfile}>
          <Field label="Display name" value={profile.displayName} onChange={(value) => setProfile({ ...profile, displayName: value })} />
          <Field label="Profile picture URL" value={profile.profilePictureUrl} onChange={(value) => setProfile({ ...profile, profilePictureUrl: value })} />
          <label className="block text-sm font-semibold">Appearance<select value={profile.appearance} onChange={(event) => {
            const appearance = event.currentTarget.value;
            if (appearance === "system" || appearance === "light" || appearance === "dark") {
              setProfile((current) => ({ ...current, appearance }));
            }
          }} className="mt-2 h-11 w-full rounded-md border border-line bg-transparent px-3 dark:border-slate-700"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <Button type="submit">Save profile</Button>
        </form>
      </section>
      <section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-2xl font-black">Security</h2>
        <form className="mt-6 space-y-4" onSubmit={changePassword}>
          <Field label="Current password" type="password" value={passwords.currentPassword} onChange={(value) => setPasswords({ ...passwords, currentPassword: value })} />
          <Field label="New password" type="password" value={passwords.password} onChange={(value) => setPasswords({ ...passwords, password: value })} />
          <Field label="Confirm password" type="password" value={passwords.confirmPassword} onChange={(value) => setPasswords({ ...passwords, confirmPassword: value })} />
          <Button type="submit">Change password</Button>
        </form>
      </section>
      <section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-2xl font-black">Connected sessions</h2>
        <div className="mt-4 space-y-3">{sessions.map((session) => <div className="rounded-md border border-line p-3 text-sm dark:border-slate-700" key={session._id}>{session.userAgent || "Unknown device"}<br /><span className="text-slate-500">{new Date(session.createdAt).toLocaleString()}</span></div>)}</div>
        <Button className="mt-5" variant="secondary" onClick={logout}>Log out</Button>
      </section>
      <section className="rounded-md border border-line bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-2xl font-black">Onboarding and account</h2>
        <div className="mt-5 flex flex-wrap gap-3"><Button onClick={restartTour}>Restart tour</Button><Button variant="secondary" onClick={() => api("/api/account/deletion-request", { method: "POST", body: "{}" }).then(() => setMessage("Deletion requested"))}>Request account deletion</Button></div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block text-sm font-semibold">{label}<input required type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-line bg-transparent px-3 dark:border-slate-700" /></label>;
}
