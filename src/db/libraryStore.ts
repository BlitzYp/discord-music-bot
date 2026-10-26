import type { LibraryFile } from "../shared/library.js";
import type { Db } from "./database.js";

/** A library file as stored: what's shown, plus its name on disk (inside data/library/<guildId>/). */
export interface StoredLibraryFile extends LibraryFile {
  guildId: string;
  /** "<id>.<extension>". */
  fileName: string;
}

interface FileRow {
  id: string;
  guild_id: string;
  file_name: string;
  original_name: string;
  title: string;
  artist: string | null;
  duration_ms: number;
  size_bytes: number;
  uploaded_by_id: string;
  uploaded_by_name: string;
  created_at: number;
}

/**
 * Saves each server's library files (the `library_files` table). The audio itself lives on disk; see
 * src/library/paths.ts.
 *
 * Only stores: limits and permissions are checked by LibraryManager before anything gets here. Every lookup by
 * file id also takes the server's id, so a file id from one server can't reach another server's file.
 */
export class LibraryStore {
  constructor(private readonly db: Db) {}

  /** The server's files, newest first. */
  list(guildId: string): StoredLibraryFile[] {
    const rows = this.db
      .prepare("SELECT * FROM library_files WHERE guild_id = ? ORDER BY created_at DESC")
      .all(guildId) as FileRow[];
    return rows.map(toFile);
  }

  /** One file, or null if the server has none with that id. */
  get(guildId: string, fileId: string): StoredLibraryFile | null {
    const row = this.db.prepare("SELECT * FROM library_files WHERE guild_id = ? AND id = ?").get(guildId, fileId) as
      | FileRow
      | undefined;
    return row ? toFile(row) : null;
  }

  /** How many bytes the server's files take up. */
  usedBytes(guildId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS used FROM library_files WHERE guild_id = ?")
      .get(guildId) as { used: number };
    return row.used;
  }

  /** Every server's file names on disk, by server id. Used at startup to delete files the database doesn't know. */
  allFileNames(): Map<string, Set<string>> {
    const rows = this.db.prepare("SELECT guild_id, file_name FROM library_files").all() as Pick<FileRow, "guild_id" | "file_name">[];
    const byGuild = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!byGuild.has(row.guild_id)) byGuild.set(row.guild_id, new Set());
      byGuild.get(row.guild_id)!.add(row.file_name);
    }
    return byGuild;
  }

  add(file: StoredLibraryFile): void {
    this.db
      .prepare(
        `INSERT INTO library_files (id, guild_id, file_name, original_name, title, artist, duration_ms, size_bytes,
                                    uploaded_by_id, uploaded_by_name, created_at)
         VALUES (@id, @guildId, @fileName, @originalName, @title, @artist, @durationMs, @sizeBytes,
                 @uploadedById, @uploadedByName, @createdAt)`,
      )
      .run({
        id: file.id,
        guildId: file.guildId,
        fileName: file.fileName,
        originalName: file.originalName,
        title: file.title,
        artist: file.artist ?? null,
        durationMs: file.durationMs,
        sizeBytes: file.sizeBytes,
        uploadedById: file.uploadedBy.id,
        uploadedByName: file.uploadedBy.name,
        createdAt: file.createdAt,
      });
  }

  delete(guildId: string, fileId: string): void {
    this.db.prepare("DELETE FROM library_files WHERE guild_id = ? AND id = ?").run(guildId, fileId);
  }
}

function toFile(row: FileRow): StoredLibraryFile {
  return {
    id: row.id,
    guildId: row.guild_id,
    fileName: row.file_name,
    originalName: row.original_name,
    title: row.title,
    artist: row.artist ?? undefined,
    durationMs: row.duration_ms,
    sizeBytes: row.size_bytes,
    uploadedBy: { id: row.uploaded_by_id, name: row.uploaded_by_name },
    createdAt: row.created_at,
  };
}
