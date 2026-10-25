import type { AudioFilter, LoopMode, QueueItem } from "../shared/types.js";
import type { Db } from "./database.js";

/** Everything needed to pick up a server's playback after a restart. */
export interface SavedPlayer {
  guildId: string;
  /** Where the bot was in voice, so it can rejoin there. */
  voiceChannelId: string | null;
  /** Where playback errors are posted. */
  textChannelId: string | null;
  current: QueueItem | null;
  /** How far into `current` playback got, in song time. */
  positionMs: number;
  paused: boolean;
  volume: number;
  loopMode: LoopMode;
  filter: AudioFilter;
  queue: QueueItem[];
  /** Newest first. */
  history: QueueItem[];
}

/** The part of SavedPlayer that changes while a song plays, without the queue changing. */
export type SavedStatus = Pick<SavedPlayer, "guildId" | "positionMs" | "paused" | "volume" | "loopMode" | "filter">;

interface PlayerStateRow {
  guild_id: string;
  voice_channel_id: string | null;
  text_channel_id: string | null;
  current_item_json: string | null;
  position_ms: number;
  paused: number;
  volume: number;
  loop_mode: string;
  filter: string;
}

/**
 * Saves each server's playback (current track, position, queue, history) so it survives a restart.
 * GuildPlayer calls `save()` whenever the track or the queue changes, and `saveStatus()` for the smaller
 * changes that happen about once a second while playing (the position).
 */
export class PlayerStateStore {
  constructor(private readonly db: Db) {}

  /** Saves a server's whole playback state, replacing what was saved before. */
  save(state: SavedPlayer): void {
    const db = this.db;
    // One transaction: a crash halfway through can't leave a queue from one moment with a track from another.
    db.transaction(() => {
      db.prepare(
        `INSERT INTO player_state (guild_id, voice_channel_id, text_channel_id, current_item_json, position_ms,
                                   paused, volume, loop_mode, filter, updated_at)
         VALUES (@guildId, @voiceChannelId, @textChannelId, @currentJson, @positionMs,
                 @paused, @volume, @loopMode, @filter, @now)
         ON CONFLICT (guild_id) DO UPDATE SET
           voice_channel_id = excluded.voice_channel_id,
           text_channel_id = excluded.text_channel_id,
           current_item_json = excluded.current_item_json,
           position_ms = excluded.position_ms,
           paused = excluded.paused,
           volume = excluded.volume,
           loop_mode = excluded.loop_mode,
           filter = excluded.filter,
           updated_at = excluded.updated_at`,
      ).run({
        guildId: state.guildId,
        voiceChannelId: state.voiceChannelId,
        textChannelId: state.textChannelId,
        currentJson: state.current ? JSON.stringify(state.current) : null,
        positionMs: Math.round(state.positionMs),
        paused: state.paused ? 1 : 0,
        volume: state.volume,
        loopMode: state.loopMode,
        filter: state.filter,
        now: Date.now(),
      });
      replaceItems(db, "queue_items", state.guildId, state.queue);
      replaceItems(db, "history_items", state.guildId, state.history);
    })();
  }

  /** Saves the position, pause state, volume, loop mode and effect. Does nothing if `save()` never ran for the server. */
  saveStatus(status: SavedStatus): void {
    this.db
      .prepare(
        `UPDATE player_state
         SET position_ms = @positionMs, paused = @paused, volume = @volume, loop_mode = @loopMode, filter = @filter,
             updated_at = @now
         WHERE guild_id = @guildId`,
      )
      .run({ ...status, positionMs: Math.round(status.positionMs), paused: status.paused ? 1 : 0, now: Date.now() });
  }

  /** Every server's saved playback. Called once at startup. */
  loadAll(): SavedPlayer[] {
    const rows = this.db.prepare("SELECT * FROM player_state").all() as PlayerStateRow[];
    return rows.map((row) => ({
      guildId: row.guild_id,
      voiceChannelId: row.voice_channel_id,
      textChannelId: row.text_channel_id,
      current: row.current_item_json ? (JSON.parse(row.current_item_json) as QueueItem) : null,
      positionMs: row.position_ms,
      paused: row.paused === 1,
      volume: row.volume,
      loopMode: row.loop_mode as LoopMode,
      filter: row.filter as AudioFilter,
      queue: loadItems(this.db, "queue_items", row.guild_id),
      history: loadItems(this.db, "history_items", row.guild_id),
    }));
  }
}

type ItemTable = "queue_items" | "history_items";

/** Replaces a server's rows in `table` with `items`, numbered from 1. */
function replaceItems(db: Db, table: ItemTable, guildId: string, items: QueueItem[]): void {
  db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
  const insert = db.prepare(`INSERT INTO ${table} (guild_id, position, item_json) VALUES (?, ?, ?)`);
  items.forEach((item, index) => insert.run(guildId, index + 1, JSON.stringify(item)));
}

function loadItems(db: Db, table: ItemTable, guildId: string): QueueItem[] {
  const rows = db.prepare(`SELECT item_json FROM ${table} WHERE guild_id = ? ORDER BY position`).all(guildId) as {
    item_json: string;
  }[];
  return rows.map((row) => JSON.parse(row.item_json) as QueueItem);
}
