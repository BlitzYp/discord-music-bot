import type { LavalinkManager, Track } from "lavalink-client";
import type { QueueItem, Requester, TrackSource } from "../../shared/types.js";
import { UserError } from "../errors.js";
import { loadWithLavalink } from "./lavalink.js";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

/** Turns user input into a TrackSource. Milestone 1 only accepts links. */
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

/**
 * Resolves a source into a track Lavalink can play. Called right before a track plays.
 * The YouTube mode switch (plugin / yt-dlp / auto) and library files arrive in later milestones.
 */
export async function resolvePlayable(lavalink: LavalinkManager, source: TrackSource, requester: Requester): Promise<Track> {
  switch (source.kind) {
    case "youtube":
    case "url":
      return loadWithLavalink(lavalink, source.url, requester);
    case "file":
      throw new UserError("Library files aren't supported yet.");
  }
}

/** The display fields of a QueueItem, read from the track when it's added. */
export type TrackMetadata = Pick<QueueItem, "title" | "author" | "durationMs" | "isStream" | "thumbnail">;

/** Fetches display metadata for a new queue item. Also returns the loaded track so it can be played straight away. */
export async function fetchMetadata(
  lavalink: LavalinkManager,
  source: TrackSource,
  requester: Requester,
): Promise<{ meta: TrackMetadata; track: Track }> {
  const track = await resolvePlayable(lavalink, source, requester);
  const { info } = track;
  return {
    track,
    meta: {
      title: info.title || "Unknown title",
      author: info.author || undefined,
      durationMs: info.isStream ? undefined : info.duration,
      isStream: info.isStream,
      thumbnail: info.artworkUrl ?? undefined,
    },
  };
}
