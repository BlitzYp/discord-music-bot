import type { Db } from "./database.js";

/**
 * The database's tables, as a list of changes. Each entry runs once, in order; SQLite's `user_version`
 * remembers how many have run. To change a table later, **add** a new entry (e.g. an `ALTER TABLE`):
 * never edit one that already ran, because existing databases won't run it again.
 */
const MIGRATIONS: string[] = [
  // 1: settings, and the playback state that survives a restart (milestone 6)
  `
  -- The owner's settings. One row per setting; the value is JSON.
  CREATE TABLE global_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Each server's settings. A server without a row uses the defaults (src/shared/settings.ts).
  CREATE TABLE guild_settings (
    guild_id               TEXT PRIMARY KEY,
    dj_role_id             TEXT,
    default_volume         INTEGER NOT NULL,
    max_queue_length       INTEGER,
    max_track_duration_sec INTEGER,
    require_same_vc        INTEGER NOT NULL,
    leave_after_sec        INTEGER NOT NULL,
    announce_channel_id    TEXT
  );

  -- What each server was playing: the current track and where it was, plus the player's settings.
  CREATE TABLE player_state (
    guild_id          TEXT PRIMARY KEY,
    voice_channel_id  TEXT,
    text_channel_id   TEXT,
    current_item_json TEXT,
    position_ms       INTEGER NOT NULL,
    paused            INTEGER NOT NULL,
    volume            INTEGER NOT NULL,
    loop_mode         TEXT NOT NULL,
    filter            TEXT NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  -- The queue, one row per QueueItem (stored as JSON). Position 1 plays next.
  CREATE TABLE queue_items (
    guild_id  TEXT NOT NULL,
    position  INTEGER NOT NULL,
    item_json TEXT NOT NULL,
    PRIMARY KEY (guild_id, position)
  );

  -- "Recently played", one row per QueueItem. Position 1 is the newest.
  CREATE TABLE history_items (
    guild_id  TEXT NOT NULL,
    position  INTEGER NOT NULL,
    item_json TEXT NOT NULL,
    PRIMARY KEY (guild_id, position)
  );
  `,
];

/** Brings the database up to date by running the migrations it hasn't run yet. */
export function migrate(db: Db): void {
  const applied = db.pragma("user_version", { simple: true }) as number;
  if (applied > MIGRATIONS.length) {
    throw new Error(`The database (version ${applied}) is newer than this code (version ${MIGRATIONS.length}). Update the bot.`);
  }

  for (let version = applied + 1; version <= MIGRATIONS.length; version++) {
    // A migration and its version number are saved together: if one statement fails, none of it is kept.
    db.transaction(() => {
      db.exec(MIGRATIONS[version - 1]!);
      db.pragma(`user_version = ${version}`);
    })();
    console.log(`[db] updated the database to version ${version}`);
  }
}
