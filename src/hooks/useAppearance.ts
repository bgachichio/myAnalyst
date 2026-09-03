// design.md §16.2, verbatim behaviour, typed for this project.
import { useEffect, useState } from "react";

export const SCALES = ["compact", "default", "large", "xlarge"] as const;
export const THEMES = ["system", "light", "dark"] as const;

export type Scale = (typeof SCALES)[number];
export type Theme = (typeof THEMES)[number];

const read = <T extends string>(key: string, fallback: T): T => {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;   // private mode, or storage disabled
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a preference that cannot persist still applies for this session */
  }
};

export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(() => read("ui.theme", "system"));
  const [fontScale, setFontScale] = useState<Scale>(() => read("ui.fontScale", "default"));

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    write("ui.theme", theme);
    if (theme === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.fontScale = fontScale;
    write("ui.fontScale", fontScale);
  }, [fontScale]);

  return { theme, setTheme, fontScale, setFontScale };
}
