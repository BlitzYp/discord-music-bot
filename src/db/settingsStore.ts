import { EventEmitter } from "node:events";
import type { UploadPermission } from "../shared/library.js";
import {
  type AutoAnnouncements,
  DEFAULT_AUTO_ANNOUNCEMENTS,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_GUILD_SETTINGS,
  type GlobalSettings,
  type GuildSettings,
} from "../shared/settings.js";
import type { Db } from "./database.js";

/** A guild_settings row, as SQLite returns it (booleans are stored as 0 or 1). */
interface GuildSettingsRow {
  dj_role_id: string | null;
  default_volume: number;
  max_queue_length: number | null;
  max_track_duration_sec: number | null;
  require_same_vc: number;
  leave_after_sec: number;
  announce_channel_id: string | null;
  upload_permission: UploadPermission;
  normalize_volume: number;
  /** JSON, or null for the defaults. */
  auto_announcements: string | null;
  voice_id: string | null;
  speech_speed: number;
}

/**
 * Reads and saves settings. Reads go straight to SQLite every time (it takes microseconds), so a change made
 * on the website applies to the very next command.
 *
 * Values are checked before they get here (src/web/routes/settings.ts); this class only stores them.
 *
 * Most settings are simply read when they're needed. The few that must apply at once, without waiting for
 * something to read them (the bot's Discord status), listen to "global:change".
 */
export class SettingsStore extends EventEmitter<{ "global:change": [settings: GlobalSettings] }> {
  constructor(private readonly db: Db) {
    super();
  }

  // ---- Global (the bot owner's) ----

  global(): GlobalSettings {
    const rows = this.db.prepare("SELECT key, value FROM global_settings").all() as { key: string; value: string }[];
    const settings: GlobalSettings = { ...DEFAULT_GLOBAL_SETTINGS };
    for (const { key, value } of rows) {
      // Rows for settings this version doesn't know (any more) are ignored.
      if (key in settings) (settings as unknown as Record<string, unknown>)[key] = JSON.parse(value);
    }
    return settings;
  }

  /** Saves the given settings (the others stay as they are) and returns all of them. */
  updateGlobal(changes: Partial<GlobalSettings>): GlobalSettings {
    const upsert = this.db.prepare(
      "INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    );
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) upsert.run(key, JSON.stringify(value));
      }
    })();
    const settings = this.global();
    this.emit("global:change", settings);
    return settings;
  }

  // ---- Per server ----

  guild(guildId: string): GuildSettings {
    const row = this.db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId) as GuildSettingsRow | undefined;
    if (!row) return { ...DEFAULT_GUILD_SETTINGS };
    return {
      djRoleId: row.dj_role_id,
      defaultVolume: row.default_volume,
      maxQueueLength: row.max_queue_length,
      maxTrackDurationSec: row.max_track_duration_sec,
      requireSameVoiceChannel: row.require_same_vc === 1,
      leaveWhenEmptyAfterSec: row.leave_after_sec,
      announceChannelId: row.announce_channel_id,
      uploadPermission: row.upload_permission,
      normalizeVolume: row.normalize_volume === 1,
      autoAnnouncements: readAutoAnnouncements(row.auto_announcements),
      voiceId: row.voice_id,
      speechSpeed: row.speech_speed,
    };
  }

  /** Saves the given settings (the others stay as they are) and returns all of the server's settings. */
  updateGuild(guildId: string, changes: Partial<GuildSettings>): GuildSettings {
    const settings: GuildSettings = { ...this.guild(guildId), ...withoutUndefined(changes) };
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, dj_role_id, default_volume, max_queue_length, max_track_duration_sec,
                                     require_same_vc, leave_after_sec, announce_channel_id, upload_permission,
                                     normalize_volume, auto_announcements, voice_id, speech_speed)
         VALUES (@guildId, @djRoleId, @defaultVolume, @maxQueueLength, @maxTrackDurationSec,
                 @requireSameVoiceChannel, @leaveWhenEmptyAfterSec, @announceChannelId, @uploadPermission,
                 @normalizeVolume, @autoAnnouncements, @voiceId, @speechSpeed)
         ON CONFLICT (guild_id) DO UPDATE SET
           dj_role_id = excluded.dj_role_id,
           default_volume = excluded.default_volume,
           max_queue_length = excluded.max_queue_length,
           max_track_duration_sec = excluded.max_track_duration_sec,
           require_same_vc = excluded.require_same_vc,
           leave_after_sec = excluded.leave_after_sec,
           announce_channel_id = excluded.announce_channel_id,
           upload_permission = excluded.upload_permission,
           normalize_volume = excluded.normalize_volume,
           auto_announcements = excluded.auto_announcements,
           voice_id = excluded.voice_id,
           speech_speed = excluded.speech_speed`,
      )
      .run({
        guildId,
        ...settings,
        requireSameVoiceChannel: settings.requireSameVoiceChannel ? 1 : 0,
        normalizeVolume: settings.normalizeVolume ? 1 : 0,
        autoAnnouncements: JSON.stringify(settings.autoAnnouncements),
      });
    return settings;
  }
}

/**
 * Reads the saved automatic announcements. Each one is laid over its default, so an announcement added in a later
 * version (missing from the saved JSON) starts with its default instead of being undefined.
 */
function readAutoAnnouncements(json: string | null): AutoAnnouncements {
  const saved = (json ? JSON.parse(json) : {}) as Partial<AutoAnnouncements>;
  return {
    songStart: { ...DEFAULT_AUTO_ANNOUNCEMENTS.songStart, ...saved.songStart },
    playlistStart: { ...DEFAULT_AUTO_ANNOUNCEMENTS.playlistStart, ...saved.playlistStart },
    memberJoin: { ...DEFAULT_AUTO_ANNOUNCEMENTS.memberJoin, ...saved.memberJoin },
    memberLeave: { ...DEFAULT_AUTO_ANNOUNCEMENTS.memberLeave, ...saved.memberLeave },
  };
}

/** Drops keys whose value is `undefined`, so spreading the result doesn't overwrite settings with nothing. */
function withoutUndefined<T extends object>(changes: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) as Partial<T>;
}
