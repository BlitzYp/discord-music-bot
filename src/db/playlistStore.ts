import type { AddedBy, PlaylistDetails, PlaylistItem, PlaylistSummary } from "../shared/playlists.js";
import type { TrackSource } from "../shared/types.js";
import type { Db } from "./database.js";

/** A song about to be added to a playlist: everything but the id the database gives it. */
export type NewPlaylistItem = Omit<PlaylistItem, "id">;

interface SummaryRow {
  id: number;
  name: string;
  created_by_id: string;
  created_by_name: string;
  created_at: number;
  song_count: number;
  total_duration_ms: number;
}

interface ItemRow {
  id: number;
  source_json: string;
  title: string;
  author: string | null;
  duration_ms: number | null;
  is_stream: number;
  thumbnail: string | null;
  added_by_id: string;
  added_by_name: string;
  added_at: number;
}

/** A playlist with its song count and total length, worked out from its songs. */
const SUMMARY_QUERY = `
  SELECT p.id, p.name, p.created_by_id, p.created_by_name, p.created_at,
         COUNT(i.id) AS song_count, COALESCE(SUM(i.duration_ms), 0) AS total_duration_ms
  FROM playlists p
  LEFT JOIN playlist_items i ON i.playlist_id = p.id`;

/**
 * Saves each server's playlists and their songs (the `playlists` and `playlist_items` tables).
 *
 * Only stores: names, limits and permissions are checked by PlaylistManager before anything gets here.
 * Every lookup by playlist id also takes the server's id, so a playlist id from one server can't reach another
 * server's playlist. Song positions are 1-based and kept without gaps (1, 2, 3...).
 */
export class PlaylistStore {
  constructor(private readonly db: Db) {}

  /** The server's playlists, sorted by name. */
  list(guildId: string): PlaylistSummary[] {
    const rows = this.db
      .prepare(`${SUMMARY_QUERY} WHERE p.guild_id = ? GROUP BY p.id ORDER BY p.name`)
      .all(guildId) as SummaryRow[];
    return rows.map(toSummary);
  }

  /** A playlist (without its songs), or null if the server has none with that id. */
  summary(guildId: string, playlistId: number): PlaylistSummary | null {
    const row = this.db
      .prepare(`${SUMMARY_QUERY} WHERE p.guild_id = ? AND p.id = ? GROUP BY p.id`)
      .get(guildId, playlistId) as SummaryRow | undefined;
    return row ? toSummary(row) : null;
  }

  /** A playlist found by name, ignoring upper/lower case, or null. */
  findByName(guildId: string, name: string): PlaylistSummary | null {
    const row = this.db
      .prepare(`${SUMMARY_QUERY} WHERE p.guild_id = ? AND p.name = ? GROUP BY p.id`)
      .get(guildId, name) as SummaryRow | undefined;
    return row ? toSummary(row) : null;
  }

  /** A playlist with its songs in order, or null if the server has none with that id. */
  details(guildId: string, playlistId: number): PlaylistDetails | null {
    const summary = this.summary(guildId, playlistId);
    if (!summary) return null;
    const rows = this.db
      .prepare("SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position")
      .all(playlistId) as ItemRow[];
    return { ...summary, items: rows.map(toItem) };
  }

  /** One song of a playlist, or null. */
  item(playlistId: number, itemId: number): PlaylistItem | null {
    const row = this.db
      .prepare("SELECT * FROM playlist_items WHERE playlist_id = ? AND id = ?")
      .get(playlistId, itemId) as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  /** Creates an empty playlist and returns its id. The name must be free (see `findByName`). */
  create(guildId: string, name: string, createdBy: AddedBy): number {
    const result = this.db
      .prepare(
        `INSERT INTO playlists (guild_id, name, created_by_id, created_by_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(guildId, name, createdBy.id, createdBy.name, Date.now());
    return Number(result.lastInsertRowid);
  }

  rename(playlistId: number, name: string): void {
    this.db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(name, playlistId);
  }

  /** Deletes a playlist and its songs. */
  delete(playlistId: number): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").run(playlistId);
      this.db.prepare("DELETE FROM playlists WHERE id = ?").run(playlistId);
    })();
  }

  /** Adds songs to the end of a playlist, in the given order. */
  addItems(playlistId: number, items: NewPlaylistItem[]): void {
    const insert = this.db.prepare(
      `INSERT INTO playlist_items (playlist_id, position, source_json, title, author, duration_ms, is_stream,
                                   thumbnail, added_by_id, added_by_name, added_at)
       VALUES (@playlistId, @position, @sourceJson, @title, @author, @durationMs, @isStream,
               @thumbnail, @addedById, @addedByName, @addedAt)`,
    );
    // One transaction: an import of 500 songs is saved all at once (and much faster than 500 separate writes).
    this.db.transaction(() => {
      let position = this.songIds(playlistId).length;
      for (const item of items) {
        position++;
        insert.run({
          playlistId,
          position,
          sourceJson: JSON.stringify(item.source),
          title: item.title,
          author: item.author ?? null,
          durationMs: item.durationMs ?? null,
          isStream: item.isStream ? 1 : 0,
          thumbnail: item.thumbnail ?? null,
          addedById: item.addedBy.id,
          addedByName: item.addedBy.name,
          addedAt: item.addedAt,
        });
      }
    })();
  }

  /** Removes one song; the songs after it move up one place. */
  removeItem(playlistId: number, itemId: number): void {
    this.reorder(playlistId, (ids) => ids.filter((id) => id !== itemId));
  }

  /** Moves a song to a new position (1 = first). The position must be from 1 to the number of songs. */
  moveItem(playlistId: number, itemId: number, toPosition: number): void {
    this.reorder(playlistId, (ids) => {
      const others = ids.filter((id) => id !== itemId);
      others.splice(toPosition - 1, 0, itemId);
      return others;
    });
  }

  /** The playlist's song ids, in order. */
  private songIds(playlistId: number): number[] {
    const rows = this.db
      .prepare("SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position")
      .all(playlistId) as { id: number }[];
    return rows.map((row) => row.id);
  }

  /**
   * Rewrites the playlist's order: `change` gets the song ids in their current order and returns the new order.
   * Songs left out of the new order are deleted. Renumbering everything keeps positions as 1, 2, 3... with no
   * gaps; a playlist has at most a few hundred songs, so that's quick.
   */
  private reorder(playlistId: number, change: (ids: number[]) => number[]): void {
    this.db.transaction(() => {
      const before = this.songIds(playlistId);
      const after = change(before);
      const kept = new Set(after);
      const remove = this.db.prepare("DELETE FROM playlist_items WHERE id = ?");
      for (const id of before) if (!kept.has(id)) remove.run(id);
      const setPosition = this.db.prepare("UPDATE playlist_items SET position = ? WHERE id = ?");
      after.forEach((id, index) => setPosition.run(index + 1, id));
    })();
  }
}

function toSummary(row: SummaryRow): PlaylistSummary {
  return {
    id: row.id,
    name: row.name,
    createdBy: { id: row.created_by_id, name: row.created_by_name },
    createdAt: row.created_at,
    songCount: row.song_count,
    totalDurationMs: row.total_duration_ms,
  };
}

function toItem(row: ItemRow): PlaylistItem {
  return {
    id: row.id,
    source: JSON.parse(row.source_json) as TrackSource,
    title: row.title,
    author: row.author ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    isStream: row.is_stream === 1,
    thumbnail: row.thumbnail ?? undefined,
    addedBy: { id: row.added_by_id, name: row.added_by_name },
    addedAt: row.added_at,
  };
}
