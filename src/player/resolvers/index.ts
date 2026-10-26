import type { LavalinkManager, Track } from "lavalink-client";
import { isYoutubePlaylistLink } from "../../shared/playlists.js";
import type { YoutubeMode } from "../../shared/settings.js";
import { isSpotifyShortLink, parseSpotifyLink, type SpotifyLink } from "../../shared/spotify.js";
import type { QueueItem, Requester, TrackSource } from "../../shared/types.js";
import { UserError } from "../errors.js";
import { loadFileWithLavalink, loadUrlWithLavalink, searchWithLavalink } from "./lavalink.js";
import { readSpotifyCollection, readSpotifyTrack, SPOTIFY_EMBED_SONG_LIMIT, searchQueryFor } from "./spotify.js";
import { downloadAudio, fetchInfo, fetchPlaylist, searchYoutubeWithYtDlp, type YtDlpPlaylistEntry } from "./ytdlp.js";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

/**
 * The ways of turning a source into something Lavalink can play: a link through Lavalink or through a yt-dlp
 * download, or a library file through Lavalink's local source.
 */
export type ResolveMethod = "lavalink" | "ytdlp" | "file";

/** Finds a library file's path on disk, or null if the file was deleted from the library. */
export type LibraryFileLookup = (fileId: string) => string | null;

export interface ResolvedTrack {
  track: Track;
  /** Which method worked, so a playback failure knows whether another method is left to try. */
  method: ResolveMethod;
}

/** The display fields of a QueueItem, read when it's added. */
export type TrackMetadata = Pick<QueueItem, "title" | "author" | "durationMs" | "isStream" | "thumbnail">;

/** The longest search someone can type, in characters. */
const MAX_SEARCH_LENGTH = 200;

/** A song found from what someone typed: its link, what's shown for it, and the loaded track if Lavalink loaded it. */
export interface FoundSong {
  source: TrackSource;
  meta: TrackMetadata;
  /** Reused to start playing right away, so the link isn't loaded twice. */
  track?: Track;
}

/**
 * Finds the song someone asked for in /play, "Add a song" or a playlist: a link is loaded as it is; a Spotify
 * track link and anything else is searched for on YouTube. Either way the result is a link, which is what the
 * queue stores: searching again when the song plays could find a different video.
 */
export async function findSong(
  lavalink: LavalinkManager,
  input: string,
  requester: Requester,
  youtubeMode: YoutubeMode,
): Promise<FoundSong> {
  if (isSpotifyShortLink(input)) throw spotifyShortLinkError();
  const spotifyLink = parseSpotifyLink(input);
  if (spotifyLink) return findSpotifySong(lavalink, spotifyLink, requester, youtubeMode);
  if (isLink(input)) {
    const source = parseInput(input);
    return { source, ...(await fetchMetadata(lavalink, source, requester, youtubeMode)) };
  }
  return searchYoutube(lavalink, input, requester, youtubeMode);
}

/**
 * Spotify doesn't let anyone stream its songs, so a Spotify track is played from YouTube: its artists and title
 * are searched for, the same as typing them.
 */
async function findSpotifySong(
  lavalink: LavalinkManager,
  link: SpotifyLink,
  requester: Requester,
  youtubeMode: YoutubeMode,
): Promise<FoundSong> {
  if (link.type !== "track") {
    throw new UserError(`That's a Spotify ${link.type}. DJs can add all of its songs to a playlist with /playlist import, or on the website.`);
  }
  const song = await readSpotifyTrack(link);
  return searchYoutube(lavalink, searchQueryFor(song), requester, youtubeMode);
}

/** Whether the input is an http(s) link (otherwise it's searched for). */
function isLink(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Searches YouTube for the best match. The owner's YouTube setting decides how, like for YouTube links: through
 * Lavalink's plugin, through yt-dlp, or the plugin first ("auto").
 */
async function searchYoutube(
  lavalink: LavalinkManager,
  input: string,
  requester: Requester,
  youtubeMode: YoutubeMode,
): Promise<FoundSong> {
  const query = input.trim().replace(/\s+/g, " ");
  if (query === "") throw new UserError("Type a song to search for, or paste a link.");
  if (query.length > MAX_SEARCH_LENGTH) throw new UserError(`Searches can be at most ${MAX_SEARCH_LENGTH} characters long.`);

  // Searching is YouTube, so it uses the same methods as a YouTube link.
  const methods = methodsFor({ kind: "youtube", url: "" }, youtubeMode);
  let lastError: unknown;
  for (const method of methods) {
    try {
      if (method === "lavalink") {
        const track = await searchWithLavalink(lavalink, query, requester);
        return { source: parseInput(track.info.uri!), meta: metadataFromTrack(track), track };
      }
      const entry = await searchYoutubeWithYtDlp(query);
      const song = entry && songFromEntry(entry);
      if (!song) throw new UserError(`Nothing was found on YouTube for "${query}".`);
      return song;
    } catch (error) {
      lastError = error;
      logFallback(method, `the search "${query}"`, error, methods);
    }
  }
  throw lastError;
}

/** Turns user input into a TrackSource. Only links; `findSong` handles searches. */
export function parseInput(input: string): Extract<TrackSource, { url: string }> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserError("Please paste a link (YouTube, SoundCloud, Bandcamp, Twitch or a direct audio URL).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UserError("Only http(s) links are supported.");
  return YOUTUBE_HOSTS.has(url.hostname) ? { kind: "youtube", url: url.href } : { kind: "url", url: url.href };
}

/** The methods to try for a link, in order. `youtubeMode` is the owner's setting (see src/shared/settings.ts). */
function methodsFor(source: TrackSource, youtubeMode: YoutubeMode): ResolveMethod[] {
  if (source.kind === "file") return ["file"]; // nothing to fall back to: the file is all there is
  if (source.kind === "youtube") {
    switch (youtubeMode) {
      case "lavalink":
        return ["lavalink"];
      case "ytdlp":
        return ["ytdlp"];
      case "auto":
        return ["lavalink", "ytdlp"];
    }
  }
  // Other sites: Lavalink first, and yt-dlp (which supports most sites too) as the backup, e.g. for SoundCloud.
  return ["lavalink", "ytdlp"];
}

/** The method to fall back to after `failed` didn't work for this source, if there is one. */
export function fallbackMethod(source: TrackSource, failed: ResolveMethod, youtubeMode: YoutubeMode): ResolveMethod | undefined {
  const methods = methodsFor(source, youtubeMode);
  return methods[methods.indexOf(failed) + 1];
}

/**
 * Turns a source into a track Lavalink can play, trying each method in order until one works.
 * Called right before a track plays. `only` restricts it to one method, e.g. to retry with yt-dlp after
 * Lavalink loaded a track but couldn't play it. `findLibraryFile` looks up library files in the player's server.
 */
export async function resolvePlayable(
  lavalink: LavalinkManager,
  source: TrackSource,
  requester: Requester,
  options: { youtubeMode: YoutubeMode; only?: ResolveMethod; findLibraryFile: LibraryFileLookup },
): Promise<ResolvedTrack> {
  if (source.kind === "file") {
    const path = options.findLibraryFile(source.fileId);
    if (!path) throw new UserError("That file was deleted from the library.");
    return { track: await loadFileWithLavalink(lavalink, path, requester), method: "file" };
  }

  const methods = options.only ? [options.only] : methodsFor(source, options.youtubeMode);
  let lastError: unknown;
  for (const method of methods) {
    try {
      const track =
        method === "lavalink"
          ? await loadUrlWithLavalink(lavalink, source.url, requester)
          : await loadFileWithLavalink(lavalink, await downloadAudio(source.url), requester);
      return { track, method };
    } catch (error) {
      lastError = error;
      logFallback(method, source.url, error, methods);
    }
  }
  throw lastError;
}

/**
 * Fetches display metadata for a new queue item. When Lavalink could load the link, the loaded track is
 * returned too, so the item can start playing without loading it again. yt-dlp only reads the metadata
 * here; the download happens when the item's turn comes.
 */
export async function fetchMetadata(
  lavalink: LavalinkManager,
  source: TrackSource,
  requester: Requester,
  youtubeMode: YoutubeMode,
): Promise<{ meta: TrackMetadata; track?: Track }> {
  // Library files get their title and length from the library when they're queued (LibraryManager.play).
  if (source.kind === "file") throw new UserError("Library files are queued from the library, not by link.");

  const methods = methodsFor(source, youtubeMode);
  let lastError: unknown;
  for (const method of methods) {
    try {
      if (method === "lavalink") {
        const track = await loadUrlWithLavalink(lavalink, source.url, requester);
        return { meta: metadataFromTrack(track), track };
      }
      const info = await fetchInfo(source.url);
      return {
        meta: {
          title: info.title || "Unknown title",
          author: info.uploader ?? info.channel,
          durationMs: info.duration === undefined ? undefined : Math.round(info.duration * 1000),
          isStream: false,
          thumbnail: info.thumbnail,
        },
      };
    } catch (error) {
      lastError = error;
      logFallback(method, source.url, error, methods);
    }
  }
  throw lastError;
}

/** A song read from a playlist link: its own link plus what's shown for it. */
export interface PlaylistEntry {
  source: TrackSource;
  meta: TrackMetadata;
}

/** The songs read from a playlist link, plus anything worth telling the person who added them. */
export interface ListedPlaylist {
  title: string;
  entries: PlaylistEntry[];
  /** Sentences like "2 songs weren't found on YouTube." Shown under the reply in Discord. */
  notes: string[];
}

/** What searching YouTube needs, for playlists whose songs are searched for (Spotify). */
export interface SearchContext {
  lavalink: LavalinkManager;
  /** Lavalink attaches this to the tracks it finds. Only the found links are kept, so it's informational. */
  requester: Requester;
  youtubeMode: YoutubeMode;
}

/** YouTube shows these instead of a title for videos in a playlist that nobody can watch any more. */
const UNAVAILABLE_TITLES = new Set(["[Private video]", "[Deleted video]"]);

/**
 * Reads the songs of a playlist link, at most `limit` of them: a YouTube playlist (or a video opened from one),
 * or a Spotify album or playlist.
 */
export async function listPlaylist(input: string, limit: number, search: SearchContext): Promise<ListedPlaylist> {
  if (isSpotifyShortLink(input)) throw spotifyShortLinkError();
  const spotifyLink = parseSpotifyLink(input);
  if (spotifyLink && spotifyLink.type !== "track") return listSpotifyCollection(spotifyLink, limit, search);

  const { url } = parseInput(input);
  if (!isYoutubePlaylistLink(url)) {
    throw new UserError(`That isn't a playlist link: use a YouTube playlist (with "list=" in it), or a Spotify album or playlist.`);
  }
  return listYoutubePlaylist(url, limit);
}

/**
 * Reads a YouTube playlist with yt-dlp, which lists the videos without downloading anything. Private and
 * deleted videos are left out.
 */
async function listYoutubePlaylist(url: string, limit: number): Promise<ListedPlaylist> {
  const playlist = await fetchPlaylist(url, limit).catch((error: unknown) => {
    throw explainPlaylistError(url, error);
  });
  const entries: PlaylistEntry[] = [];
  for (const entry of playlist.entries ?? []) {
    const song = songFromEntry(entry);
    if (song) entries.push(song);
  }
  // A personal mix opened from one of its songs (`watch?v=...&list=RD...`) loads, but with only that one song,
  // because the rest is only shown to its signed-in owner. A real mix has dozens.
  const isMix = new URL(url).searchParams.get("list")?.startsWith("RD") ?? false;
  if (isMix && entries.length <= 1) throw personalMixError();
  if (entries.length === 0) throw new UserError("No playable songs were found in that playlist.");
  return { title: playlist.title || "Imported playlist", entries, notes: [] };
}

/** How many Spotify songs are searched for on YouTube at the same time. More is faster, but YouTube may refuse. */
const SPOTIFY_SEARCHES_AT_ONCE = 4;

/**
 * Reads a Spotify album or playlist and finds each of its songs on YouTube, like a text search. The links that
 * were found are what gets queued or saved, so a song can't change between adding and playing it. Songs YouTube
 * has no match for are left out and counted in the notes.
 */
async function listSpotifyCollection(link: SpotifyLink, limit: number, search: SearchContext): Promise<ListedPlaylist> {
  const { title, songs } = await readSpotifyCollection(link);
  if (songs.length === 0) throw new UserError(`That Spotify ${link.type} has no songs.`);

  const wanted = songs.slice(0, limit);
  let lastError: unknown;
  const found = await mapWithLimit(wanted, SPOTIFY_SEARCHES_AT_ONCE, async (song) => {
    try {
      const { source, meta } = await searchYoutube(search.lavalink, searchQueryFor(song), search.requester, search.youtubeMode);
      return { source, meta };
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
      console.warn(`[spotify] left out "${searchQueryFor(song)}": ${reason}`);
      return null;
    }
  });
  const entries = found.filter((entry): entry is PlaylistEntry => entry !== null);

  if (entries.length === 0) {
    // Every search failing for the same non-user reason (Lavalink down, YouTube blocking) is worth showing as is.
    if (lastError instanceof UserError) throw new UserError(`None of the songs of that Spotify ${link.type} were found on YouTube.`);
    throw lastError;
  }

  const notes: string[] = [];
  const missing = wanted.length - entries.length;
  if (missing > 0) notes.push(`${missing} ${missing === 1 ? "song wasn't" : "songs weren't"} found on YouTube.`);
  // The embed page doesn't say how many songs there are in total, so exactly 100 may or may not be all of them.
  if (songs.length >= SPOTIFY_EMBED_SONG_LIMIT) {
    notes.push(`Spotify only shows the bot the first ${SPOTIFY_EMBED_SONG_LIMIT} songs of a ${link.type}; if it has more, the rest are missing.`);
  }
  return { title, entries, notes };
}

/** Runs `work` on every item, at most `limit` at a time, and returns the results in the items' order. */
async function mapWithLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  // Each worker takes the next item until none are left. JavaScript runs one at a time between awaits, so two
  // workers can't take the same index.
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await work(items[index]!);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * A video from yt-dlp's list output (a playlist, or search results) as a song, or null if it can't be played:
 * no link or title, or a private or deleted video.
 */
function songFromEntry(entry: YtDlpPlaylistEntry): PlaylistEntry | null {
  if (!entry.url || !entry.title || UNAVAILABLE_TITLES.has(entry.title)) return null;
  let source: TrackSource;
  try {
    source = parseInput(entry.url);
  } catch {
    return null; // not an http(s) link; nothing we could play
  }
  return {
    source,
    meta: {
      title: entry.title,
      author: entry.uploader ?? entry.channel ?? undefined,
      durationMs: entry.duration ? Math.round(entry.duration * 1000) : undefined,
      isStream: false,
      thumbnail: largestThumbnail(entry.thumbnails),
    },
  };
}

/** A new error each time, so each one has its own stack trace. */
const spotifyShortLinkError = () =>
  new UserError(
    "spotify.link short links aren't supported. Open the link in a browser and paste the address it goes to " +
      "(it starts with https://open.spotify.com/).",
  );

/** A new error each time, so each one has its own stack trace. */
const personalMixError = () =>
  new UserError(
  "That's a YouTube mix made for your account (like Replay Mix or My Supermix), and YouTube only shows those " +
    "to you when you're signed in, so the bot can't read it. To keep its songs, save the mix as a playlist in " +
    "YouTube (⋮ → Save to playlist), make that playlist Public or Unlisted, and import it.",
);

/**
 * YouTube answers "The playlist does not exist" for any playlist it won't show to a logged-out visitor, which
 * the bot always is. Two common cases get a message that says what to do instead:
 * - Personal mixes (Replay Mix, My Supermix, Discover Mix…): their ids start with "RD" and they exist only for
 *   the signed-in owner. Mixes started from a song (`watch?v=...&list=RD...`) are public and do work.
 * - Private playlists.
 */
function explainPlaylistError(url: string, error: unknown): unknown {
  const doesNotExist = error instanceof Error && error.message.includes("The playlist does not exist");
  if (!doesNotExist) return error;

  const listId = new URL(url).searchParams.get("list") ?? "";
  if (listId.startsWith("RD")) return personalMixError();
  return new UserError("YouTube says that playlist doesn't exist. If it's yours, set it to Public or Unlisted (not Private).");
}

function largestThumbnail(thumbnails: { url: string; width?: number }[] | undefined): string | undefined {
  if (!thumbnails?.length) return undefined;
  return thumbnails.reduce((best, t) => ((t.width ?? 0) > (best.width ?? 0) ? t : best)).url;
}

function metadataFromTrack(track: Track): TrackMetadata {
  const { info } = track;
  return {
    title: info.title || "Unknown title",
    author: info.author || undefined,
    durationMs: info.isStream ? undefined : info.duration,
    isStream: info.isStream,
    thumbnail: info.artworkUrl ?? undefined,
  };
}

/**
 * Logs that a method failed, when another one is about to be tried. The final failure is reported by the caller.
 * `what` is the link, or a description like `the search "..."`.
 */
function logFallback(method: ResolveMethod, what: string, error: unknown, methods: ResolveMethod[]): void {
  if (method === methods.at(-1)) return;
  const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  console.warn(`[resolver] ${method} couldn't load ${what} (${reason}); trying the next method`);
}
