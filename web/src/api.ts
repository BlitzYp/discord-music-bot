import type {
  AdminStatus,
  AudioFilter,
  CurrentUser,
  GlobalSettings,
  GuildSettings,
  GuildSettingsResponse,
  GuildSummary,
  LoopMode,
  PlayerSnapshot,
} from "./shared";

/** An error answer from the bot's API, with its HTTP status (401 = not logged in). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Calls the bot's REST API. Changes are always sent as JSON (even with no data), because the server refuses
 * anything else as protection against other websites (see src/web/http.ts).
 */
async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const isChange = method !== "GET";
  const res = await fetch(`/api${path}`, {
    method,
    headers: isChange ? { "Content-Type": "application/json" } : undefined,
    body: isChange ? JSON.stringify(body ?? {}) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (HTTP ${res.status})`);
  return json as T;
}

// ---- Login ----

/** The logged-in user, or null if nobody is logged in. */
export async function fetchMe(): Promise<CurrentUser | null> {
  try {
    return await request<CurrentUser>("GET", "/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Login is a full-page trip to Discord and back, so it's a link rather than a request. */
export const LOGIN_URL = "/api/auth/login";

export function logout(): Promise<unknown> {
  return request("POST", "/auth/logout");
}

// ---- Servers ----

export function fetchGuilds(): Promise<GuildSummary[]> {
  return request("GET", "/guilds");
}

// ---- Controls (DJ only; the page updates through the socket afterwards) ----

type State = Promise<PlayerSnapshot>;

export const addToQueue = (guildId: string, input: string): State => request("POST", `/guilds/${guildId}/queue`, { input });
export const removeFromQueue = (guildId: string, itemId: string): State =>
  request("DELETE", `/guilds/${guildId}/queue/${itemId}`);
/** `position` is 1-based, like the numbers in the list: 1 = play next. */
export const moveInQueue = (guildId: string, itemId: string, position: number): State =>
  request("PATCH", `/guilds/${guildId}/queue/${itemId}`, { position });
export const shuffleQueue = (guildId: string): State => request("POST", `/guilds/${guildId}/queue/shuffle`);

export const skip = (guildId: string): State => request("POST", `/guilds/${guildId}/player/skip`);
export const pause = (guildId: string): State => request("POST", `/guilds/${guildId}/player/pause`);
export const resume = (guildId: string): State => request("POST", `/guilds/${guildId}/player/resume`);
export const stop = (guildId: string): State => request("POST", `/guilds/${guildId}/player/stop`);
export const seek = (guildId: string, positionMs: number): State =>
  request("POST", `/guilds/${guildId}/player/seek`, { positionMs });
export const setVolume = (guildId: string, volume: number): State =>
  request("POST", `/guilds/${guildId}/player/volume`, { volume });
export const setLoopMode = (guildId: string, mode: LoopMode): State =>
  request("POST", `/guilds/${guildId}/player/loop`, { mode });
export const setFilter = (guildId: string, filter: AudioFilter): State =>
  request("POST", `/guilds/${guildId}/player/filter`, { filter });

// ---- A server's settings (server admins) ----

export const fetchGuildSettings = (guildId: string): Promise<GuildSettingsResponse> =>
  request("GET", `/guilds/${guildId}/settings`);
/** Saves the given settings; the others stay as they are. */
export const updateGuildSettings = (guildId: string, changes: Partial<GuildSettings>): Promise<GuildSettingsResponse> =>
  request("PATCH", `/guilds/${guildId}/settings`, changes);

// ---- The Admin page (bot owner) ----

export const fetchGlobalSettings = (): Promise<GlobalSettings> => request("GET", "/admin/settings");
export const updateGlobalSettings = (changes: Partial<GlobalSettings>): Promise<GlobalSettings> =>
  request("PATCH", "/admin/settings", changes);
export const fetchAdminStatus = (): Promise<AdminStatus> => request("GET", "/admin/status");
/** Updates yt-dlp now. Answers with yt-dlp's last line of output, e.g. "yt-dlp is up to date (2026.10.01)". */
export const updateYtDlpNow = (): Promise<{ message: string }> => request("POST", "/admin/ytdlp/update");
