import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";
import { Loader } from "../components/ui/Loader";

export type User = {
  id: string;
  displayName: string;
  email: string;
  profilePictureUrl?: string;
  role?: "user" | "admin" | "support";
  status: string;
  emailVerified: boolean;
  onboarding?: { completed?: boolean; skipped?: boolean; step?: number };
  preferences?: { appearance?: "system" | "light" | "dark"; emailUpdates?: boolean; supportEmails?: boolean; generationNotifications?: boolean; marketingEmails?: boolean };
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const data = await api<{ user: User }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (user?.preferences?.appearance) { localStorage.setItem("theme", user.preferences.appearance); window.dispatchEvent(new Event("theme:changed")); } }, [user?.id, user?.preferences?.appearance]);
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
    setUser(null);
  };
  const value = useMemo(() => ({ user, loading, refresh, setUser, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center bg-cloud dark:bg-slate-950"><Loader label="Checking your session" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}
