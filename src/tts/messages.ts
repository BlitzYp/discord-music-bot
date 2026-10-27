import { MAX_ANNOUNCEMENT_LENGTH } from "../shared/announcements.js";

/**
 * Fills in an automatic announcement's message: each `{word}` becomes its value, e.g. "Now playing {song}" with
 * `{ song: "One More Time" }` → "Now playing One More Time". A `{word}` that has no value is left as it is, so a
 * typo shows up when it's heard instead of silently disappearing.
 */
export function fillMessage(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, word: string) => values[word] ?? placeholder);
}

/** "Ann" · "Ann and Bob" · "Ann, Bob and Cy": names as they'd be said. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Shortens a filled-in message to the announcement limit, at the last space that fits. A long song title can push
 * a message over it; an automatic announcement should then be cut short rather than not said at all.
 */
export function shortenForSpeech(text: string, maxLength = MAX_ANNOUNCEMENT_LENGTH): string {
  const tidy = text.replace(/\s+/g, " ").trim();
  if (tidy.length <= maxLength) return tidy;
  const cut = tidy.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}
