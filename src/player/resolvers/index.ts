import type { LavalinkManager, Track } from "lavalink-client";
import type { QueueItem, Requester, TrackSource } from "../../shared/types.js";
import { UserError } from "../errors.js";
import { loadFileWithLavalink, loadUrlWithLavalink } from "./lavalink.js";
import { downloadAudio, fetchInfo } from "./ytdlp.js";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

/**
 * How YouTube links are loaded:
 * - "lavalink": only through Lavalink's YouTube plugin.
 * - "ytdlp": only through yt-dlp (slower: each song is downloaded first, which takes about 10 seconds).
 * - "auto": the plugin first, yt-dlp if the plugin fails.
 * Hardcoded for now; becomes the owner's setting in the admin panel in milestone 6.
 */
export type YoutubeMode = "lavalink" | "ytdlp" | "auto";
export const YOUTUBE_MODE: YoutubeMode = "auto";

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
export function parseInput(input: string): TrackSource {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserError("Please paste a link (YouTube, SoundCloud, Bandcamp, Twitch or a direct audio URL). Text search comes later.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UserError("Only http(s) links are supported.");
  return YOUTUBE_HOSTS.has(url.hostname) ? { kind: "youtube", url: url.href } : { kind: "url", url: url.href };
}

/** The methods to try for a link, in order. */
function methodsFor(source: TrackSource): ResolveMethod[] {
  if (source.kind === "youtube") {
    switch (YOUTUBE_MODE) {
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
export function fallbackMethod(source: TrackSource, failed: ResolveMethod): ResolveMethod | undefined {
  const methods = methodsFor(source);
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
  options: { only?: ResolveMethod } = {},
): Promise<ResolvedTrack> {
  if (source.kind === "file") throw new UserError("Library files aren't supported yet.");

  const methods = options.only ? [options.only] : methodsFor(source);
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
): Promise<{ meta: TrackMetadata; track?: Track }> {
  if (source.kind === "file") throw new UserError("Library files aren't supported yet.");

  const methods = methodsFor(source);
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
