// Types shared between the backend and (later) the React frontend.

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
  queue: QueueItem[];
}
