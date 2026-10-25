import type { GuildSummary } from "./shared";

/** Fetches JSON from the bot's REST API, turning error responses into thrown Errors with the server's message. */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
  return body as T;
}

export function fetchGuilds(): Promise<GuildSummary[]> {
  return getJson<GuildSummary[]>("/guilds");
}
