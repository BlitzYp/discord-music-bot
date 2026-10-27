import type {
  AddManyResult,
  AdminStatus,
  AudioFilter,
  CurrentUser,
  GlobalSettings,
  GuildSettings,
  GuildSettingsResponse,
  GuildSummary,
  LibraryFile,
  LibraryOverview,
  LoopMode,
  PlayerSnapshot,
  PlaylistDetails,
  PlaylistPlayMode,
  PlaylistSummary,
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

/** `next: true` puts the new songs in front of the queue ("Play next") instead of at the end. */
interface AddOptions {
  next?: boolean;
}

export const addToQueue = (guildId: string, input: string, options: AddOptions = {}): State =>
  request("POST", `/guilds/${guildId}/queue`, { input, ...options });
/** Queues a file from the server's library. */
export const addLibraryFileToQueue = (guildId: string, fileId: string): State =>
  request("POST", `/guilds/${guildId}/queue`, { fileId });
/** Queues every song of a YouTube playlist link (up to 500). Spotify album and playlist links do this with addToQueue too. */
export const addWholePlaylistToQueue = (guildId: string, input: string, options: AddOptions = {}): State =>
  request("POST", `/guilds/${guildId}/queue`, { input, wholePlaylist: true, ...options });
export const removeFromQueue = (guildId: string, itemId: string): State =>
  request("DELETE", `/guilds/${guildId}/queue/${itemId}`);
/** `position` is 1-based, like the numbers in the list: 1 = play next. */
export const moveInQueue = (guildId: string, itemId: string, position: number): State =>
  request("PATCH", `/guilds/${guildId}/queue/${itemId}`, { position });
/** Plays a queued item right away; the current track is skipped. */
export const playNowFromQueue = (guildId: string, itemId: string): State =>
  request("POST", `/guilds/${guildId}/queue/${itemId}/play`);
export const shuffleQueue = (guildId: string): State => request("POST", `/guilds/${guildId}/queue/shuffle`);
/** Empties the queue; the current track keeps playing. */
export const clearQueue = (guildId: string): State => request("DELETE", `/guilds/${guildId}/queue`);
export const clearHistory = (guildId: string): State => request("DELETE", `/guilds/${guildId}/history`);

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
/** Volume normalization: every song at about the same loudness. A server setting; DJs switch it. */
export const setNormalizeVolume = (guildId: string, enabled: boolean): State =>
  request("POST", `/guilds/${guildId}/player/normalize`, { enabled });
export const setFilter = (guildId: string, filter: AudioFilter): State =>
  request("POST", `/guilds/${guildId}/player/filter`, { filter });
/** Says `text` in voice (text-to-speech). Answers once it has been said. */
export const announce = (guildId: string, text: string): State =>
  request("POST", `/guilds/${guildId}/player/announce`, { text });

// ---- Saved playlists (everyone looks and adds songs; DJs do the rest) ----

const playlistsPath = (guildId: string) => `/guilds/${guildId}/playlists`;
type Playlist = Promise<PlaylistDetails>;

export const fetchPlaylists = (guildId: string): Promise<PlaylistSummary[]> => request("GET", playlistsPath(guildId));
export const fetchPlaylist = (guildId: string, playlistId: number): Playlist =>
  request("GET", `${playlistsPath(guildId)}/${playlistId}`);
export const createPlaylist = (guildId: string, name: string): Playlist => request("POST", playlistsPath(guildId), { name });
/** Creates a playlist from a YouTube playlist or Spotify album/playlist link. Without a name it's named after it. */
export const importPlaylist = (guildId: string, importUrl: string, name?: string): Playlist =>
  request("POST", playlistsPath(guildId), { importUrl, name });
/** Saves the current song plus the queue as a new playlist. */
export const saveQueueAsPlaylist = (guildId: string, name: string): Playlist =>
  request("POST", `${playlistsPath(guildId)}/from-queue`, { name });
export const renamePlaylist = (guildId: string, playlistId: number, name: string): Playlist =>
  request("PATCH", `${playlistsPath(guildId)}/${playlistId}`, { name });
export const deletePlaylist = (guildId: string, playlistId: number): Promise<PlaylistSummary[]> =>
  request("DELETE", `${playlistsPath(guildId)}/${playlistId}`);
export const playPlaylist = (
  guildId: string,
  playlistId: number,
  mode: PlaylistPlayMode,
): Promise<{ result: AddManyResult; state: PlayerSnapshot }> =>
  request("POST", `${playlistsPath(guildId)}/${playlistId}/play`, { mode });

export const addToPlaylist = (guildId: string, playlistId: number, input: string): Playlist =>
  request("POST", `${playlistsPath(guildId)}/${playlistId}/items`, { input });
/** Adds every song of a YouTube playlist or Spotify album/playlist link to the playlist (DJs). */
export const importIntoPlaylist = (guildId: string, playlistId: number, importUrl: string): Playlist =>
  request("POST", `${playlistsPath(guildId)}/${playlistId}/items`, { importUrl });
export const removeFromPlaylist = (guildId: string, playlistId: number, itemId: number): Playlist =>
  request("DELETE", `${playlistsPath(guildId)}/${playlistId}/items/${itemId}`);
/** `position` is 1-based, like the numbers in the list. */
export const moveInPlaylist = (guildId: string, playlistId: number, itemId: number, position: number): Playlist =>
  request("PATCH", `${playlistsPath(guildId)}/${playlistId}/items/${itemId}`, { position });

// ---- The library (everyone looks; uploading follows the server's setting; DJs delete) ----

export const fetchLibrary = (guildId: string): Promise<LibraryOverview> => request("GET", `/guilds/${guildId}/library`);
export const deleteLibraryFile = (guildId: string, fileId: string): Promise<LibraryOverview> =>
  request("DELETE", `/guilds/${guildId}/library/${fileId}`);

/**
 * Uploads a file to the server's library. `onProgress` gets the share sent so far (0 to 1); after it reaches 1,
 * the bot still checks (and maybe converts) the file before answering.
 *
 * This uses XMLHttpRequest rather than fetch, because fetch can't report upload progress. The upload isn't JSON,
 * so it carries the header the bot requires instead (see UPLOAD_HEADER in src/web/http.ts).
 */
export function uploadToLibrary(guildId: string, file: File, onProgress: (sent: number) => void): Promise<LibraryFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/guilds/${guildId}/library`);
    xhr.setRequestHeader("X-Requested-With", "music-bot");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const json = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as LibraryFile);
      else reject(new ApiError(xhr.status, json.error ?? `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload was interrupted. Check your connection and try again."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

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
