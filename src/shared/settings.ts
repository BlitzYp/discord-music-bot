// Settings shared by the bot and the website: the owner's global settings and each server's settings.
// They are stored in SQLite (src/db/settingsStore.ts) and edited on the website.

import type { UploadPermission } from "./library.js";
import { MAX_VOLUME } from "./player.js";

/**
 * How YouTube links are loaded:
 * - "auto": Lavalink's YouTube plugin first, yt-dlp if the plugin fails.
 * - "lavalink": only through the plugin.
 * - "ytdlp": only through yt-dlp (slower: each song is downloaded first, which takes about 10 seconds).
 */
export const YOUTUBE_MODES = ["auto", "lavalink", "ytdlp"] as const;
export type YoutubeMode = (typeof YOUTUBE_MODES)[number];

/**
 * The kinds of Discord status the bot can show. Discord writes them as "Listening to <text>", "Playing <text>",
 * "Watching <text>" and "Competing in <text>"; a "custom" status shows the text on its own.
 */
export const BOT_STATUS_TYPES = ["custom", "listening", "playing", "watching", "competing"] as const;
export type BotStatusType = (typeof BOT_STATUS_TYPES)[number];

/** The dot on the bot's avatar: green (online), the moon (idle) or red (do not disturb). */
export const BOT_STATUS_DOTS = ["online", "idle", "dnd"] as const;
export type BotStatusDot = (typeof BOT_STATUS_DOTS)[number];

/** Discord cuts status text after 128 characters. */
export const MAX_BOT_STATUS_LENGTH = 128;

/** What the bot's Discord status shows. */
export interface BotStatus {
  type: BotStatusType;
  text: string;
  dot: BotStatusDot;
}

/** Settings for the whole bot. Only the bot owner (OWNER_ID) can change them, on the website's Admin page. */
export interface GlobalSettings {
  youtubeMode: YoutubeMode;
  /** Update yt-dlp every time the bot starts. YouTube changes often break old versions. */
  ytdlpAutoUpdate: boolean;
  /** The biggest file one library upload may be, in megabytes. */
  maxUploadMb: number;
  /** How much space each server's library may use, in megabytes. */
  guildQuotaMb: number;
  /**
   * A fixed Discord status for the bot, shown instead of the automatic one ("Listening to <song>", "Idle · /play
   * to start"; see src/bot/presence.ts). null = automatic.
   */
  statusOverride: BotStatus | null;
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  youtubeMode: "auto",
  ytdlpAutoUpdate: true,
  maxUploadMb: 100,
  guildQuotaMb: 2000,
  statusOverride: null,
};

/** The allowed range of each global number setting. The Admin page uses them for its inputs; the server checks them. */
export const GLOBAL_SETTING_LIMITS = {
  maxUploadMb: { min: 1, max: 2000 },
  guildQuotaMb: { min: 10, max: 1_000_000 },
} as const;

/** One server's settings. Server admins change them on the website's Settings page. */
export interface GuildSettings {
  /**
   * Members with this role are DJs (may control playback). null = no DJ role picked yet, so only admins can
   * control playback. The server's @everyone role (its id equals the server's id) makes every member a DJ.
   */
  djRoleId: string | null;
  /** The volume the bot starts at when it joins voice, in percent. */
  defaultVolume: number;
  /** The most songs the queue may hold (not counting the one playing). null = no limit. */
  maxQueueLength: number | null;
  /** The longest song that may be added, in seconds. null = no limit. Livestreams are always allowed. */
  maxTrackDurationSec: number | null;
  /** DJs must be in the bot's voice channel to control playback while it's in one. Admins never need to. */
  requireSameVoiceChannel: boolean;
  /** How long the bot stays in a voice channel nobody is listening in. 0 = never leave. */
  leaveWhenEmptyAfterSec: number;
  /** A text channel where the bot posts "Now playing" for every new song. null = no announcements. */
  announceChannelId: string | null;
  /** Who may upload files to the server's library (see UPLOAD_PERMISSIONS in src/shared/library.ts). */
  uploadPermission: UploadPermission;
}

export const DEFAULT_GUILD_SETTINGS: GuildSettings = {
  djRoleId: null,
  defaultVolume: 100,
  maxQueueLength: null,
  maxTrackDurationSec: null,
  requireSameVoiceChannel: false,
  leaveWhenEmptyAfterSec: 60,
  announceChannelId: null,
  uploadPermission: "dj",
};

/** The allowed range of each number setting. The website uses them for its inputs; the server checks them. */
export const SETTING_LIMITS = {
  defaultVolume: { min: 0, max: MAX_VOLUME },
  maxQueueLength: { min: 1, max: 10_000 },
  maxTrackDurationSec: { min: 10, max: 24 * 60 * 60 },
  leaveWhenEmptyAfterSec: { min: 0, max: 24 * 60 * 60 },
} as const;

// -------------------------------------------------------------------------------------------------
// What the website's settings pages receive
// -------------------------------------------------------------------------------------------------

/** GET /api/guilds/:id/settings: the settings, plus the roles and channels to choose from. */
export interface GuildSettingsResponse {
  settings: GuildSettings;
  /** The server's roles, highest first. The @everyone role is included (it makes everyone a DJ). */
  roles: { id: string; name: string; color: string | null }[];
  /** Text channels the bot can post "Now playing" messages in. */
  textChannels: { id: string; name: string }[];
}

/** GET /api/admin/status: how the parts of the bot are doing, for the owner's Admin page. */
export interface AdminStatus {
  bot: { uptimeMs: number; servers: number; activePlayers: number };
  lavalink: {
    connected: boolean;
    version: string | null;
    /** The YouTube plugin's version, from Lavalink's plugin list. */
    youtubePluginVersion: string | null;
    players: number | null;
    playingPlayers: number | null;
    uptimeMs: number | null;
    memoryUsedMb: number | null;
  };
  ytdlp: { version: string | null };
  /** ffmpeg checks and converts library uploads. null = not found. */
  ffmpeg: { version: string | null };
  /** The bot's Discord status right now, and whether it's the owner's fixed one (statusOverride) or the automatic one. */
  discordStatus: BotStatus & { overridden: boolean };
}
