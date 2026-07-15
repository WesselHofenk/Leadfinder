"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try { localStorage.setItem("leadfinder-theme", next); } catch { /* Theme still works for this page. */ }
    setTheme(next);
  }

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={dark ? "Lichte modus inschakelen" : "Donkere modus inschakelen"}
      aria-pressed={dark}
      title={dark ? "Lichte modus" : "Donkere modus"}
    >
      <Sun className="theme-icon theme-icon-sun" size={18} aria-hidden="true" />
      <Moon className="theme-icon theme-icon-moon" size={18} aria-hidden="true" />
    </button>
  );
}
