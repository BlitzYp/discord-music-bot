import type { QueueItem } from "../shared/types.js";

export function formatDuration(ms: number | undefined, isStream?: boolean): string {
  if (isStream) return "live";
  if (ms === undefined) return "?:??";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Formats an item as a clickable title plus its duration: "[Title](url) `3:45`". */
export function formatItem(item: QueueItem): string {
  // Put a backslash before Markdown characters, so a title like "*NEW* song" isn't shown in bold.
  const title = item.title.replace(/([\\[\]*_~`|>])/g, "\\$1").slice(0, 100);
  // The <...> around the URL stops Discord from showing a big link preview.
  const link = item.source.kind === "file" ? title : `[${title}](<${item.source.url}>)`;
  return `${link} \`${formatDuration(item.durationMs, item.isStream)}\``;
}
