import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

/** Every server's library: data/library/<guildId>/<fileId>.<extension>. */
export const LIBRARY_DIR = join(PROJECT_ROOT, "data", "library");

/**
 * Where uploads wait while they're checked (and converted, if needed). Emptied on every start, so a crash
 * mid-upload doesn't leave files behind. Its name starts with a dot so it can't be mistaken for a server's folder.
 */
export const INCOMING_DIR = join(LIBRARY_DIR, ".incoming");

/** A server's library folder. */
export function guildLibraryDir(guildId: string): string {
  return join(LIBRARY_DIR, guildId);
}

/** Where a library file is on disk. `fileName` is the stored "<id>.<extension>", never a name someone uploaded. */
export function libraryFilePath(guildId: string, fileName: string): string {
  return join(guildLibraryDir(guildId), fileName);
}
