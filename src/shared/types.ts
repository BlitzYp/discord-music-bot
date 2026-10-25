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

/** Audio effects that can be applied to playback, one at a time. See src/player/filters.ts for what each does. */
export const AUDIO_FILTERS = ["off", "nightcore", "vaporwave", "bassboost", "8d", "karaoke", "soft"] as const;
export type AudioFilter = (typeof AUDIO_FILTERS)[number];

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
}
