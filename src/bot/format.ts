import { formatDuration } from "../shared/format.js";
import type { QueueItem } from "../shared/types.js";

// Re-exported so commands can keep importing all formatting from one place.
export { formatDuration };

/** Formats an item as a clickable title plus its duration: "[Title](url) `3:45`". */
export function formatItem(item: QueueItem): string {
  // Put a backslash before Markdown characters, so a title like "*NEW* song" isn't shown in bold.
  const title = item.title.replace(/([\\[\]*_~`|>])/g, "\\$1").slice(0, 100);
  // The <...> around the URL stops Discord from showing a big link preview.
  const link = item.source.kind === "file" ? title : `[${title}](<${item.source.url}>)`;
  return `${link} \`${formatDuration(item.durationMs, item.isStream)}\``;
}
