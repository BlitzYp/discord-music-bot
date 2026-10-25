// Saved playlists (milestone 7): types and limits shared by the bot and the website.

import type { TrackSource } from "./types.js";

/** The most songs one playlist may hold. Also caps how many songs one import reads. */
export const MAX_PLAYLIST_SONGS = 500;
/** The longest playlist name, in characters. */
export const MAX_PLAYLIST_NAME_LENGTH = 50;

/** Who added something: a Discord user id and the name they had at the time. */
export interface AddedBy {
  id: string;
  name: string;
}

/** A playlist in the server's list (GET /guilds/:id/playlists). */
export interface PlaylistSummary {
  id: number;
  name: string;
  createdBy: AddedBy;
  /** Milliseconds since 1970, like Date.now(). */
  createdAt: number;
  songCount: number;
  /** The songs' total length. Songs with an unknown length (livestreams) count as 0. */
  totalDurationMs: number;
}

/**
 * One song in a playlist. Like a queue item it stores the link, not a playable track: it's loaded only when
 * it plays (see "Resolve at play time" in AGENTS.md).
 */
export interface PlaylistItem {
  id: number;
  source: TrackSource;
  title: string;
  author?: string;
  durationMs?: number;
  isStream?: boolean;
  thumbnail?: string;
  addedBy: AddedBy;
  addedAt: number;
}

/** A playlist with its songs, in order (GET /guilds/:id/playlists/:playlistId). */
export interface PlaylistDetails extends PlaylistSummary {
  items: PlaylistItem[];
}

/**
 * What playing a playlist does:
 * - "replace": stop the current song, empty the queue, and queue the playlist's songs in order;
 * - "append": add the playlist's songs to the end of the queue.
 */
export type PlaylistPlayMode = "replace" | "append";

/** The answer to adding several songs to the queue at once (a playlist, or every song of a playlist link). */
export interface AddManyResult {
  /** How many songs went into the queue (including one that started playing). */
  added: number;
  /** Songs left out because they're longer than the server's `maxTrackDurationSec`. */
  tooLong: number;
  /** Songs left out because the queue reached the server's `maxQueueLength`. */
  queueFull: number;
}

/** "Queued 12 songs. 2 left out for being longer than this server allows." Shown in Discord and on the website. */
export function describeAddMany({ added, tooLong, queueFull }: AddManyResult): string {
  const parts = [`Queued ${added} ${added === 1 ? "song" : "songs"}.`];
  if (tooLong > 0) parts.push(`${tooLong} left out for being longer than this server allows.`);
  if (queueFull > 0) parts.push(`${queueFull} didn't fit: the queue is full.`);
  return parts.join(" ");
}

/**
 * Whether a link points at a YouTube playlist: a playlist page, or a video opened from a playlist
 * (`watch?v=...&list=...`). For the website to offer "add the whole playlist"; the bot checks again itself.
 */
export function isYoutubePlaylistLink(input: string): boolean {
  try {
    const url = new URL(input.trim());
    const isYoutube = /(^|\.)youtube\.com$/.test(url.hostname) || url.hostname === "youtu.be";
    return isYoutube && url.searchParams.has("list");
  } catch {
    return false;
  }
}
