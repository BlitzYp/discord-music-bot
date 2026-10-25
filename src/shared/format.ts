// Formatting helpers used by both the Discord bot and the website.

/** Formats milliseconds as "3:45" or "1:02:03". Streams show "live"; unknown durations show "?:??". */
export function formatDuration(ms: number | undefined, isStream?: boolean): string {
  if (isStream) return "live";
  if (ms === undefined) return "?:??";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
