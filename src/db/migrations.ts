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

  // 2: saved playlists (milestone 7)
  `
  -- Each server's playlists. COLLATE NOCASE makes "Chill" and "chill" the same name, for lookups too.
  CREATE TABLE playlists (
    id              INTEGER PRIMARY KEY,
    guild_id        TEXT NOT NULL,
    name            TEXT NOT NULL COLLATE NOCASE,
    created_by_id   TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    UNIQUE (guild_id, name)
  );

  -- The songs of each playlist, in order: position 1 plays first. Like the queue, a song is stored as its link
  -- (source_json, a TrackSource) plus what's shown on the page; it's loaded only when it plays.
  CREATE TABLE playlist_items (
    id            INTEGER PRIMARY KEY,
    playlist_id   INTEGER NOT NULL,
    position      INTEGER NOT NULL,
    source_json   TEXT NOT NULL,
    title         TEXT NOT NULL,
    author        TEXT,
    duration_ms   INTEGER,
    is_stream     INTEGER NOT NULL,
    thumbnail     TEXT,
    added_by_id   TEXT NOT NULL,
    added_by_name TEXT NOT NULL,
    added_at      INTEGER NOT NULL
  );
  CREATE INDEX playlist_items_by_playlist ON playlist_items (playlist_id, position);
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
