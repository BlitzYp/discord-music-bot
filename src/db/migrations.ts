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

  // 3: the library of uploaded files (milestone 8)
  `
  -- Each server's uploaded audio files. The file itself is data/library/<guild_id>/<file_name>, where file_name is
  -- "<id>.<extension>": the uploaded name (original_name) is only shown, never used in a path.
  CREATE TABLE library_files (
    id               TEXT PRIMARY KEY,
    guild_id         TEXT NOT NULL,
    file_name        TEXT NOT NULL,
    original_name    TEXT NOT NULL,
    title            TEXT NOT NULL,
    artist           TEXT,
    duration_ms      INTEGER NOT NULL,
    size_bytes       INTEGER NOT NULL,
    uploaded_by_id   TEXT NOT NULL,
    uploaded_by_name TEXT NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX library_files_by_guild ON library_files (guild_id, created_at);

  -- Who may upload: 'dj', 'admin' or 'off' (src/shared/library.ts).
  ALTER TABLE guild_settings ADD COLUMN upload_permission TEXT NOT NULL DEFAULT 'dj';
  `,

  // 4: volume normalization (added after milestone 9)
  `
  -- How loud each song is, measured once with ffmpeg (src/player/loudness.ts). song_key says which song:
  -- "youtube:<video id>", "file:<library file id>" or "url:<link>". Shared by all servers.
  CREATE TABLE loudness (
    song_key       TEXT PRIMARY KEY,
    loudness_lufs  REAL NOT NULL,
    true_peak_dbtp REAL NOT NULL,
    measured_at    INTEGER NOT NULL
  );

  -- Whether the server plays every song at about the same loudness (DJs switch it with /normalize). 0 or 1.
  ALTER TABLE guild_settings ADD COLUMN normalize_volume INTEGER NOT NULL DEFAULT 0;
  `,

  // 5: automatic announcements (added after milestone 9)
  `
  -- What the bot says by itself in voice, and when (AutoAnnouncements in src/shared/settings.ts), as JSON.
  -- NULL = the defaults (all off).
  ALTER TABLE guild_settings ADD COLUMN auto_announcements TEXT;
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
