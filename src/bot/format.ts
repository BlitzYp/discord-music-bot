import { formatDuration } from "../shared/format.js";
import { describeAddMany } from "../shared/playlists.js";
import type { QueueItem } from "../shared/types.js";

// Re-exported so commands can keep importing all formatting from one place.
export { describeAddMany, formatDuration };

/** Formats an item as a clickable title plus its duration: "[Title](url) `3:45`". Also works for playlist songs. */
export function formatItem(item: Pick<QueueItem, "title" | "source" | "durationMs" | "isStream">): string {
  const title = escapeMarkdown(item.title).slice(0, 100);
  // The <...> around the URL stops Discord from showing a big link preview.
  const link = item.source.kind === "file" ? title : `[${title}](<${item.source.url}>)`;
  return `${link} \`${formatDuration(item.durationMs, item.isStream)}\``;
}

/** Puts a backslash before Markdown characters, so a title like "*NEW* song" isn't shown in bold. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\[\]*_~`|>])/g, "\\$1");
}
