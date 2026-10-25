/** An error whose message is safe and useful to show to the user as-is. */
export class UserError extends Error {
  override name = "UserError";
}

/**
 * Turns an error message into one short line for Discord or the website. Lavalink's messages can contain
 * a Java stack trace for every YouTube client it tried; the full text belongs in the console instead.
 */
export function summarizeError(message: string): string {
  if (message.includes("All clients failed")) {
    return "YouTube refused to play this video. Details are in the bot's console.";
  }
  const firstLine = message.split("\n")[0]?.trim() || "unknown error";
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}
