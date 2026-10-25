import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrations.js";

export type Db = Database.Database;

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
/** Everything the bot remembers: settings, queues and history. Delete it (with the bot stopped) to start fresh. */
export const DATABASE_FILE = join(PROJECT_ROOT, "data", "bot.db");

/**
 * Opens the SQLite database, creating it and its tables if needed. Pass ":memory:" for a throwaway database
 * (used when testing).
 *
 * better-sqlite3 is synchronous: every query finishes before the next line runs. That keeps the code simple,
 * and the queries here are tiny, so they don't hold up the bot.
 */
export function openDatabase(file: string = DATABASE_FILE): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  // Write-ahead logging: faster writes, and a crash or a killed process can't corrupt the database.
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}
