import type { AudioFilter, GuildSummary, PlayerSnapshot } from "./shared";

/** Calls the bot's REST API, turning error responses into thrown Errors with the server's message. */
async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (HTTP ${res.status})`);
  return json as T;
}

export function fetchGuilds(): Promise<GuildSummary[]> {
  return request("GET", "/guilds");
}

/** Switches the server's audio effect. The page updates through the socket, like for changes made in Discord. */
export function setFilter(guildId: string, filter: AudioFilter): Promise<PlayerSnapshot> {
  return request("POST", `/guilds/${guildId}/player/filter`, { filter });
}
