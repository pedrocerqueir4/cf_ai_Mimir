import { Sun, Moon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useState, useEffect } from "react";
import { getStoredTheme, setStoredTheme, applyTheme } from "~/lib/theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = getStoredTheme();
    const dark =
      stored === "dark" ||
      (stored === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    setIsDark(dark);
    applyTheme(stored);
  }, []);

  function toggle() {
    const next = isDark ? "light" : "dark";
    setIsDark(!isDark);
    setStoredTheme(next);
    applyTheme(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="min-h-12 min-w-12"
    >
      {isDark ? <Sun size={20} /> : <Moon size={20} />}
    </Button>
  );
}
