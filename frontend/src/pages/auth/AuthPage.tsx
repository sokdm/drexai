import {TurnstileChallenge} from '../../components/TurnstileChallenge';
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { brand } from "@drex/shared";
import { BrandMark } from "../../components/layout/BrandMark";
import { Button } from "../../components/ui/Button";
import { ThemeToggle } from "../../components/ui/ThemeToggle";
import { Loader } from "../../components/ui/Loader";
import { api } from "../../lib/api";
import { useAuth, type User } from "../../lib/auth";

const copy = {
  login: ["Welcome back", "Sign in to continue."],
  signup: ["Create your Drex workspace", "First tell us who is setting up the account."],
  forgot: ["Recover access", "Enter your account email and we will send a reset code."],
  verify: ["Enter your OTP code", "Check your email for the six-digit Drex verification code."],
  reset: ["Reset password", "Use your reset code to choose a new password."]
};

const countries = ["Nigeria", "United States", "United Kingdom", "Ghana", "Kenya", "South Africa", "Canada", "Other"];

export function AuthPage({ mode }: { mode: keyof typeof copy }) {
  const params = new URLSearchParams(location.search);
  const [form, setForm] = useState<Record<string, string | boolean>>({ email: params.get("email") ?? "", country: "Nigeria", termsAccepted: false });
  const [securityToken,setSecurityToken]=useState(''),[securityAttempt,setSecurityAttempt]=useState(0);
  const [signupStep, setSignupStep] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [title, subtitle] = copy[mode];
  const set = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "signup" && signupStep === 1) {
      if (!form.name || !form.country) return setError("Enter your name and country to continue.");
      setError("");
      setSignupStep(2);
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      if (mode === "signup") {
        await api("/api/auth/register", { method: "POST", body: JSON.stringify({...form,turnstileToken:securityToken}) });
        navigate(`/verify-email?email=${encodeURIComponent(String(form.email ?? ""))}`);
      } else if (mode === "verify") {
        const data = await api<{ user: User }>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({...form,turnstileToken:securityToken}) });
        setUser(data.user);
        navigate("/dashboard");
      } else if (mode === "login") {
        const data = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({...form,turnstileToken:securityToken}) });
        setUser(data.user);
        navigate("/dashboard");
      } else if (mode === "forgot") {
        const data = await api<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({...form,turnstileToken:securityToken}) });
        setMessage(`${data.message} Go to Reset Password when you receive the code.`);
      } else if (mode === "reset") {
        const data = await api<{ message: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({...form,turnstileToken:securityToken}) });
        setMessage(data.message);
        setTimeout(() => navigate("/login"), 900);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong";
      if (text.toLowerCase().includes("verification")) navigate(`/verify-email?email=${encodeURIComponent(String(form.email ?? ""))}`);
      else setError(text);
    } finally {
      setLoading(false);setSecurityToken('');setSecurityAttempt(n=>n+1);
    }
  }

  return (
    <div className="grid min-h-screen bg-cloud text-ink dark:bg-slate-950 dark:text-white lg:grid-cols-[0.92fr_1.08fr]">
      <aside className="hidden border-r border-line bg-white p-10 dark:border-slate-800 dark:bg-slate-900 lg:block">
        <BrandMark />
        <div className="mt-14 max-w-md">
          <div className="mb-8 rounded-md border border-line bg-cloud p-5 dark:border-slate-700 dark:bg-slate-950"><Loader label="Securing your creator workspace" /></div>
          <h1 className="text-5xl font-black">{brand.name} account setup</h1>
          <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">Create an account, verify your email OTP, then enter the dashboard with your wallet and research tools ready.</p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <div className="mb-8 flex items-center justify-between"><BrandMark /><ThemeToggle /></div>
          <div className="rounded-md border border-line bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <AuthHeader mode={mode} title={title} subtitle={subtitle} signupStep={signupStep} />
            <form className="mt-8 space-y-4" onSubmit={submit}>
              {mode === "signup" && signupStep === 1 && <SignupIdentity form={form} set={set} />}
              {mode === "signup" && signupStep === 2 && <SignupCredentials form={form} set={set} />}
              {mode === "login" && <><Field label="Email" type="email" value={String(form.email ?? "")} onChange={(value) => set("email", value)} /><Field label="Password" type="password" value={String(form.password ?? "")} onChange={(value) => set("password", value)} /></>}
              {mode === "verify" && <OtpFields form={form} set={set} resend={() => resend(form.email, setMessage, setError)} />}
              {mode === "forgot" && <Field label="Email" type="email" value={String(form.email ?? "")} onChange={(value) => set("email", value)} />}
              {mode === "reset" && <><Field label="Email" type="email" value={String(form.email ?? "")} onChange={(value) => set("email", value)} /><Field label="Reset code" value={String(form.code ?? "")} onChange={(value) => set("code", value)} /><Field label="New password" type="password" value={String(form.password ?? "")} onChange={(value) => set("password", value)} /><Field label="Confirm password" type="password" value={String(form.confirmPassword ?? "")} onChange={(value) => set("confirmPassword", value)} /></>}
              {(mode==="login"||mode==="signup"&&signupStep===2)&&<TurnstileChallenge key={securityAttempt} action={mode==="signup"?"signup":"login"} onToken={setSecurityToken}/>}
              {error && <p className="rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
              {message && <p className="rounded-md bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">{message}</p>}
              <div className="flex gap-2">
                {mode === "signup" && signupStep === 2 && <Button type="button" variant="secondary" onClick={() => setSignupStep(1)}>Back</Button>}
                <Button className="flex-1" type="submit" disabled={loading}>{loading ? "Working..." : mode === "verify" ? "Verify and enter dashboard" : signupStep === 1 && mode === "signup" ? "Continue" : "Submit"}</Button>
              </div>
            </form>
            <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-600 dark:text-slate-300"><Link to="/login">Login</Link><Link to="/signup">Sign Up</Link><Link to="/forgot-password">Forgot Password</Link><Link to="/reset-password">Reset Password</Link><Link to="/terms">Terms</Link></div>
          </div>
        </div>
      </main>
    </div>
  );
}

function AuthHeader({ mode, title, subtitle, signupStep }: { mode: string; title: string; subtitle: string; signupStep: number }) {
  return <div><p className="text-sm font-bold text-brand dark:text-brand-dark">{mode === "signup" ? `Step ${signupStep} of 2` : mode === "verify" ? "Email verification" : "Secure access"}</p><h2 className="mt-2 text-3xl font-black">{title}</h2><p className="mt-2 text-slate-600 dark:text-slate-300">{subtitle}</p></div>;
}

function SignupIdentity({ form, set }: { form: Record<string, string | boolean>; set: (key: string, value: string | boolean) => void }) {
  return <><Field label="Full name" value={String(form.name ?? "")} onChange={(value) => set("name", value)} /><label className="block text-sm font-semibold">Country<select required value={String(form.country ?? "Nigeria")} onChange={(event) => set("country", event.target.value)} className="mt-2 h-11 w-full rounded-md border border-line bg-transparent px-3 dark:border-slate-700">{countries.map((country) => <option key={country} value={country}>{country}</option>)}</select></label></>;
}

function SignupCredentials({ form, set }: { form: Record<string, string | boolean>; set: (key: string, value: string | boolean) => void }) {
  return <><Field label="Email" type="email" value={String(form.email ?? "")} onChange={(value) => set("email", value)} /><Field label="Password" type="password" value={String(form.password ?? "")} onChange={(value) => set("password", value)} /><Field label="Confirm password" type="password" value={String(form.confirmPassword ?? "")} onChange={(value) => set("confirmPassword", value)} /><Field label="Invite code optional" required={false} value={String(form.inviteCode ?? "")} onChange={(value) => set("inviteCode", value)} /><label className="flex items-start gap-3 rounded-md border border-line p-3 text-sm dark:border-slate-700"><input required type="checkbox" checked={Boolean(form.termsAccepted)} onChange={(event) => set("termsAccepted", event.target.checked)} className="mt-1" /><span>I agree to the <Link className="font-bold text-brand" to="/terms">Drex Terms of Service</Link>.</span></label></>;
}

function OtpFields({ form, set, resend }: { form: Record<string, string | boolean>; set: (key: string, value: string | boolean) => void; resend: () => void }) {
  return <><Field label="Email" type="email" value={String(form.email ?? "")} onChange={(value) => set("email", value)} /><Field label="Six-digit OTP code" inputMode="numeric" maxLength={6} value={String(form.code ?? "")} onChange={(value) => set("code", value.replace(/\D/g, "").slice(0, 6))} /><p className="text-sm text-slate-500">The code expires in 15 minutes. Check inbox and spam.</p><Button type="button" variant="secondary" onClick={resend}>Resend OTP</Button></>;
}

async function resend(email: string | boolean | undefined, setMessage: (value: string) => void, setError: (value: string) => void) {
  try {
    const data = await api<{ message: string }>("/api/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
    setMessage(data.message);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not resend OTP");
  }
}

function Field({ label, value, onChange, type = "text", required = true, inputMode, maxLength }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; inputMode?: "numeric"; maxLength?: number }) {
  return <label className="block text-sm font-semibold">{label}<input required={required} type={type} inputMode={inputMode} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-line bg-transparent px-3 dark:border-slate-700" /></label>;
}
