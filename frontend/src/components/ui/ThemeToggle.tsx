import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Button";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") !== "light");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <Button variant="ghost" className="h-10 w-10 px-0" aria-label="Toggle theme" onClick={() => setDark((value) => !value)}>
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </Button>
  );
}
