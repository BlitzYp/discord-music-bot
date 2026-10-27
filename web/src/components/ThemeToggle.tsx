import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Where the visitor's choice is kept. `web/index.html` reads the same key before the page draws, so a dark-mode
 * visitor doesn't see a flash of light colors on load.
 */
const STORAGE_KEY = "theme";

const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function systemTheme(): Theme {
  return systemDarkQuery.matches ? "dark" : "light";
}

/** The saved choice, or `null` to follow the system theme. */
function readSavedTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null; // storage can be blocked (private windows, strict privacy settings)
  }
}

/** Saves the choice; `null` forgets it so the page follows the system theme again. */
function saveTheme(theme: Theme | null): void {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, theme);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not saved, but the toggle still works until the page is reloaded.
  }
}

/**
 * Switches between light and dark. The CSS reads the `data-theme` attribute on <html>; without it, the system
 * theme applies. Picking the theme the system already uses clears the saved choice, so the page goes back to
 * following the system (for example when it switches to dark mode in the evening).
 */
export function ThemeToggle() {
  const [savedTheme, setSavedTheme] = useState<Theme | null>(readSavedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const shownTheme = savedTheme ?? system;

  useEffect(() => {
    const onSystemChange = () => setSystem(systemTheme());
    systemDarkQuery.addEventListener("change", onSystemChange);
    return () => systemDarkQuery.removeEventListener("change", onSystemChange);
  }, []);

  useEffect(() => {
    if (savedTheme) document.documentElement.dataset.theme = savedTheme;
    else delete document.documentElement.dataset.theme;
  }, [savedTheme]);

  function toggle() {
    const next: Theme = shownTheme === "dark" ? "light" : "dark";
    const nextSaved = next === system ? null : next;
    saveTheme(nextSaved);
    setSavedTheme(nextSaved);
  }

  const label = shownTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" className="small theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {shownTheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}
