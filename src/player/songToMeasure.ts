import type { LavalinkManager, Track } from "lavalink-client";
import type { QueueItem } from "../shared/types.js";
import type { AudioInput } from "./measureLoudness.js";
import type { ResolveMethod } from "./resolvers/index.js";

/** A song to measure: its key in the loudness cache, and where ffmpeg reads its audio. */
export interface SongToMeasure {
  key: string;
  input: AudioInput;
}

/** What's known about a song once it has been loaded for playing. */
export interface LoadedSong {
  track: Track;
  method: ResolveMethod;
}

/**
 * Works out how to measure a queued song's loudness, or returns null if it can't be (livestreams, and links that
 * only Lavalink can read, like SoundCloud or Twitch: those play unadjusted).
 *
 * `loaded` is the track Lavalink is about to play. Without it (measuring the next song ahead of time), only
 * YouTube songs and library files can be measured, since a link's kind is known only after loading it.
 */
export function songToMeasure(
  item: QueueItem,
  loaded: LoadedSong | null,
  lavalink: LavalinkManager,
  findLibraryFile: (fileId: string) => string | null,
): SongToMeasure | null {
  if (item.isStream) return null;
  const { source } = item;

  if (source.kind === "file") {
    const path = findLibraryFile(source.fileId);
    return path ? { key: `file:${source.fileId}`, input: { kind: "file", path } } : null;
  }

  const youtubeId = source.kind === "youtube" ? youtubeVideoId(source.url) : null;
  const key = youtubeId ? `youtube:${youtubeId}` : `url:${source.url}`;

  // Downloaded by yt-dlp: measure the downloaded file.
  if (loaded?.method === "ytdlp" && loaded.track.info.uri) {
    return { key, input: { kind: "file", path: loaded.track.info.uri } };
  }
  // YouTube: Lavalink's YouTube plugin streams the audio for us (GET /youtube/stream/<id>).
  if (youtubeId) {
    const stream = youtubeStreamOf(lavalink, youtubeId);
    return stream ? { key, input: stream } : null;
  }
  // A direct link to an audio file: ffmpeg can read it as it is. Lavalink calls that source "http", which
  // lavalink-client's list of source names leaves out, hence the widening to string.
  const sourceName: string | undefined = loaded?.track.info.sourceName;
  if (sourceName === "http") {
    return { key, input: { kind: "link", url: source.url } };
  }
  return null;
}

/** The YouTube plugin's audio stream for a video, with the Lavalink password it needs. */
function youtubeStreamOf(lavalink: LavalinkManager, videoId: string): AudioInput | null {
  const node = lavalink.nodeManager.leastUsedNodes()[0];
  if (!node) return null;
  const { host, port, secure, authorization } = node.options;
  const url = `${secure ? "https" : "http"}://${host}:${port}/youtube/stream/${encodeURIComponent(videoId)}`;
  return { kind: "link", url, headers: { Authorization: authorization } };
}

/**
 * The video id in a YouTube link: `watch?v=<id>` (also on music.youtube.com), `youtu.be/<id>`, `/shorts/<id>`
 * or `/live/<id>`. The same video has many link forms, so the cache is keyed by the id.
 */
function youtubeVideoId(link: string): string | null {
  const url = new URL(link);
  if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
  const fromQuery = url.searchParams.get("v");
  if (fromQuery) return fromQuery;
  const [kind, id] = url.pathname.split("/").filter(Boolean);
  return (kind === "shorts" || kind === "live") && id ? id : null;
}
