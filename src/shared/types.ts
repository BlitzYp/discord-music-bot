// Types shared between the backend and the React website.

import type { AudioFilter } from "./filters.js";
import type { PermissionLevel } from "./permissions.js";

/** One audio effect at a time; the list of effects lives in src/shared/filters.ts. */
export type { AudioFilter };

export type TrackSource =
  | { kind: "youtube"; url: string }
  | { kind: "url"; url: string } // SoundCloud, Bandcamp, Twitch, direct HTTP...
  | { kind: "file"; fileId: string }; // library file

export interface Requester {
  id: string;
  name: string;
  via: "discord" | "web";
}

export interface QueueItem {
  id: string; // uuid, used for remove/reorder
  source: TrackSource;
  title: string;
  author?: string;
  durationMs?: number;
  isStream?: boolean;
  thumbnail?: string;
  requestedBy: Requester;
}

/**
 * What happens when a track finishes:
 * - "off": move on to the next item.
 * - "track": play the same item again.
 * - "queue": move the item to the end of the queue, so the whole queue repeats.
 */
export type LoopMode = "off" | "track" | "queue";


export interface PlayerSnapshot {
  guildId: string;
  voiceChannelId: string | null;
  current: QueueItem | null;
  positionMs: number;
  paused: boolean;
  volume: number;
  loopMode: LoopMode;
  filter: AudioFilter;
  queue: QueueItem[];
  /** Recently played items, newest first. */
  history: QueueItem[];
}

/** The part of a snapshot that changes without the queue changing. Sent about once a second while playing. */
export type PlayerStatus = Pick<PlayerSnapshot, "positionMs" | "paused" | "volume" | "loopMode" | "filter">;

// -------------------------------------------------------------------------------------------------
// Web API and Socket.IO
// -------------------------------------------------------------------------------------------------

/** The logged-in website user (GET /api/me). */
export interface SessionUser {
  id: string;
  /** The display name (Discord's "global name"), falling back to the username. */
  name: string;
  avatarUrl: string;
}

/** A server shown in the website's server list (GET /api/guilds): one the user and the bot are both in. */
export interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  /** What the logged-in user may do there. */
  level: PermissionLevel;
}

/** Messages the server pushes to the browser. Changes go over REST; sockets only push updates. */
export interface ServerToClientEvents {
  /** The full state, sent right after the browser joins a server's room. */
  state: (state: PlayerSnapshot) => void;
  /** The current track or the queue changed. */
  "queue:update": (state: PlayerSnapshot) => void;
  /** Position, pause, volume, loop mode or filter changed. */
  "player:update": (status: PlayerStatus) => void;
  "track:start": (item: QueueItem) => void;
  "track:end": (item: QueueItem, reason: string) => void;
  /** A short, user-readable playback error. */
  error: (message: string) => void;
}

/** Messages the browser sends to the server. */
export interface ClientToServerEvents {
  /** Start receiving updates for a server (and stop receiving them for the previous one). */
  "guild:watch": (guildId: string) => void;
}
