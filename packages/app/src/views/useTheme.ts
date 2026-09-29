import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "jint-theme";

/** System | light | dark, persisted; system follows prefers-color-scheme live. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mql.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    if (theme === "system") {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
  }, [theme]);

  const choose = (next: Theme) => {
    setTheme(next);
    localStorage.setItem(KEY, next);
  };

  return { theme, choose };
}
