import type { LavalinkManager, Track } from "lavalink-client";
import type { YoutubeMode } from "../../shared/settings.js";
import type { QueueItem, Requester, TrackSource } from "../../shared/types.js";
import { UserError } from "../errors.js";
import { loadFileWithLavalink, loadUrlWithLavalink } from "./lavalink.js";
import { downloadAudio, fetchInfo, fetchPlaylist } from "./ytdlp.js";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

/** The two ways of turning a link into something Lavalink can play. */
export type ResolveMethod = "lavalink" | "ytdlp";

export interface ResolvedTrack {
  track: Track;
  /** Which method worked, so a playback failure knows whether another method is left to try. */
  method: ResolveMethod;
}

/** The display fields of a QueueItem, read when it's added. */
export type TrackMetadata = Pick<QueueItem, "title" | "author" | "durationMs" | "isStream" | "thumbnail">;

/** Turns user input into a TrackSource. Only links are accepted for now. */
export function parseInput(input: string): Extract<TrackSource, { url: string }> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserError("Please paste a link (YouTube, SoundCloud, Bandcamp, Twitch or a direct audio URL). Text search comes later.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UserError("Only http(s) links are supported.");
  return YOUTUBE_HOSTS.has(url.hostname) ? { kind: "youtube", url: url.href } : { kind: "url", url: url.href };
}

/** The methods to try for a link, in order. `youtubeMode` is the owner's setting (see src/shared/settings.ts). */
function methodsFor(source: TrackSource, youtubeMode: YoutubeMode): ResolveMethod[] {
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
 * Lavalink loaded a track but couldn't play it.
 */
export async function resolvePlayable(
  lavalink: LavalinkManager,
  source: TrackSource,
  requester: Requester,
  options: { youtubeMode: YoutubeMode; only?: ResolveMethod },
): Promise<ResolvedTrack> {
  if (source.kind === "file") throw new UserError("Library files aren't supported yet.");

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
  if (source.kind === "file") throw new UserError("Library files aren't supported yet.");

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

/** YouTube shows these instead of a title for videos in a playlist that nobody can watch any more. */
const UNAVAILABLE_TITLES = new Set(["[Private video]", "[Deleted video]"]);

/**
 * Reads the songs of a playlist link (a YouTube playlist, or a video opened from one), at most `limit` of them.
 * Uses yt-dlp, which lists them without downloading anything. Private and deleted videos are left out.
 */
export async function listPlaylist(url: string, limit: number): Promise<{ title: string; entries: PlaylistEntry[] }> {
  const playlist = await fetchPlaylist(url, limit);
  const entries: PlaylistEntry[] = [];
  for (const entry of playlist.entries ?? []) {
    if (!entry.url || !entry.title || UNAVAILABLE_TITLES.has(entry.title)) continue;
    let source: TrackSource;
    try {
      source = parseInput(entry.url);
    } catch {
      continue; // not an http(s) link; nothing we could play
    }
    entries.push({
      source,
      meta: {
        title: entry.title,
        author: entry.uploader ?? entry.channel ?? undefined,
        durationMs: entry.duration ? Math.round(entry.duration * 1000) : undefined,
        isStream: false,
        thumbnail: largestThumbnail(entry.thumbnails),
      },
    });
  }
  if (entries.length === 0) throw new UserError("No playable songs were found in that playlist.");
  return { title: playlist.title || "Imported playlist", entries };
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

/** Logs that a method failed, when another one is about to be tried. The final failure is reported by the caller. */
function logFallback(method: ResolveMethod, url: string, error: unknown, methods: ResolveMethod[]): void {
  if (method === methods.at(-1)) return;
  const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  console.warn(`[resolver] ${method} couldn't load ${url} (${reason}); trying the next method`);
}
