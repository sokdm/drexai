import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Button";
export function ThemeToggle() {
 const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
 useEffect(() => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => { const mode = localStorage.getItem("theme") || "system", value = mode === "dark" || mode === "system" && media.matches; document.documentElement.classList.toggle("dark", value); setDark(value); };
  sync(); window.addEventListener("theme:changed", sync); media.addEventListener("change", sync);
  return () => { window.removeEventListener("theme:changed", sync); media.removeEventListener("change", sync); };
 }, []);
 return <Button variant="ghost" className="h-10 w-10 px-0" aria-label="Toggle theme" onClick={() => { localStorage.setItem("theme", dark ? "light" : "dark"); window.dispatchEvent(new Event("theme:changed")); }}>{dark ? <Sun size={18} /> : <Moon size={18} />}</Button>;
}
