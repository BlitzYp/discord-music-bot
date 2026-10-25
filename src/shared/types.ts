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

export interface PlayerSnapshot {
  guildId: string;
  voiceChannelId: string | null;
  current: QueueItem | null;
  positionMs: number;
  paused: boolean;
  queue: QueueItem[];
}
