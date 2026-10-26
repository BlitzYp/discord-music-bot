import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { LibraryStore, StoredLibraryFile } from "../db/libraryStore.js";
import type { SettingsStore } from "../db/settingsStore.js";
import { NotAllowedError, UserError } from "../player/errors.js";
import type { PlayerManager, VoiceRequest } from "../player/PlayerManager.js";
import { formatBytes, type LibraryFile, type LibraryOverview } from "../shared/library.js";
import type { AddedBy } from "../shared/playlists.js";
import { hasLevel, type PermissionLevel } from "../shared/permissions.js";
import type { QueueItem, Requester } from "../shared/types.js";
import { type AudioProbe, convertToOpus, probeAudio } from "./ffmpeg.js";
import { guildLibraryDir, INCOMING_DIR, LIBRARY_DIR, libraryFilePath } from "./paths.js";

/** Events LibraryManager emits. src/web/socket.ts tells the server's open pages to reload the library. */
export interface LibraryManagerEvents {
  /** A file was added to or deleted from this server's library. */
  change: [guildId: string];
}

/** The longest title kept from a file's tags or name. */
const MAX_TITLE_LENGTH = 200;

/**
 * Containers and codecs Lavalink plays as they are. Everything else is converted to Opus first.
 * `container` is ffprobe's name for it; `extension` is what the saved file gets.
 */
const PLAYABLE_AS_IS: { container: string; codecs: string[]; extension: string }[] = [
  { container: "mp3", codecs: ["mp3"], extension: "mp3" },
  { container: "flac", codecs: ["flac"], extension: "flac" },
  // Plain 16-bit PCM is the WAV that's sure to play. Other WAVs (24-bit, float) are converted, which also makes
  // them a lot smaller.
  { container: "wav", codecs: ["pcm_s16le"], extension: "wav" },
  { container: "ogg", codecs: ["opus", "vorbis", "flac"], extension: "ogg" },
  { container: "mov,mp4,m4a,3gp,3g2,mj2", codecs: ["aac"], extension: "m4a" },
  { container: "matroska,webm", codecs: ["opus", "vorbis"], extension: "webm" },
];

/**
 * Each server's library of uploaded audio files: adding (from the website or a Discord attachment), deleting,
 * and queuing them.
 *
 * Adding a file:
 * 1. The upload is saved to data/library/.incoming/ (by the web route, or `saveAttachment` for Discord).
 * 2. ffprobe checks that it's really audio, and reads its length and tags.
 * 3. If Lavalink can't play it as it is, ffmpeg converts it to Opus.
 * 4. It's moved to data/library/<guildId>/<fileId>.<extension> and gets a row in the database.
 *
 * Who may call what (member, DJ, the server's upload setting) is checked before calling, by the command or the
 * route, with `checkCanUpload` for uploads. Playing a file goes through PlayerManager like any other playback.
 */
export class LibraryManager extends EventEmitter<LibraryManagerEvents> {
  constructor(
    private readonly store: LibraryStore,
    private readonly settings: SettingsStore,
    private readonly players: PlayerManager,
  ) {
    super();
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  /** The server's files (newest first), its storage use and limits. */
  overview(guildId: string): LibraryOverview {
    return {
      files: this.store.list(guildId).map(toPublicFile),
      usedBytes: this.store.usedBytes(guildId),
      quotaBytes: this.quotaBytes(),
      maxUploadBytes: this.maxUploadBytes(),
      uploadPermission: this.settings.guild(guildId).uploadPermission,
    };
  }

  /** A file of the server. Throws if there's none with that id (e.g. it was just deleted). */
  get(guildId: string, fileId: string): LibraryFile {
    const file = this.store.get(guildId, fileId);
    if (!file) throw new UserError("That file isn't in the library any more.");
    return toPublicFile(file);
  }

  /**
   * A file found by what someone typed in Discord: the file id (what name suggestions send), else a title or file
   * name, ignoring upper/lower case. A part of a title works too, if only one file matches it.
   */
  find(guildId: string, typed: string): LibraryFile {
    const files = this.store.list(guildId);
    const byId = files.find((file) => file.id === typed);
    if (byId) return toPublicFile(byId);

    const wanted = typed.trim().toLowerCase();
    const exact = files.find((file) => file.title.toLowerCase() === wanted || file.originalName.toLowerCase() === wanted);
    if (exact) return toPublicFile(exact);
    const partial = files.filter((file) => matchesSearch(file, wanted));
    if (partial.length === 1) return toPublicFile(partial[0]!);
    if (partial.length > 1) throw new UserError(`${partial.length} files match "${typed.trim()}". Pick one from the suggestions.`);
    throw new UserError(`There's no file called "${typed.trim()}" in the library. /library list shows them.`);
  }

  /** The server's files whose title, artist or file name contains `search` (all of them for an empty search). */
  search(guildId: string, search: string): LibraryFile[] {
    const wanted = search.trim().toLowerCase();
    return this.store.list(guildId).filter((file) => matchesSearch(file, wanted)).map(toPublicFile);
  }

  /** The biggest file one upload may be, from the owner's `maxUploadMb` setting. */
  maxUploadBytes(): number {
    return this.settings.global().maxUploadMb * 1024 * 1024;
  }

  // ---------------------------------------------------------------------------------------------
  // Adding and deleting
  // ---------------------------------------------------------------------------------------------

  /**
   * Throws unless someone with this level may upload to the server's library (its `uploadPermission` setting).
   * Called before an upload starts, so nobody waits for a big upload only to be refused.
   */
  checkCanUpload(guildId: string, level: PermissionLevel): void {
    const permission = this.settings.guild(guildId).uploadPermission;
    if (permission === "off") throw new NotAllowedError("Uploads to the library are turned off in this server.");
    if (!hasLevel(level, permission)) {
      throw new NotAllowedError(permission === "admin" ? "Only server admins can upload files here." : "Only DJs can upload files here.");
    }
  }

  /** A new path in the incoming folder for an upload to be saved to while it's checked. */
  async incomingPath(): Promise<string> {
    await mkdir(INCOMING_DIR, { recursive: true });
    return join(INCOMING_DIR, randomUUID());
  }

  /**
   * Downloads a Discord attachment into the incoming folder and adds it to the library. Discord's links to
   * attachments expire after about a day, which is why the file is copied rather than queued as a link.
   */
  async addAttachment(
    guildId: string,
    attachment: { url: string; name: string; size: number },
    uploadedBy: AddedBy,
  ): Promise<LibraryFile> {
    this.checkFits(guildId, attachment.size);
    const path = await this.incomingPath();
    try {
      const response = await fetch(attachment.url);
      if (!response.ok || !response.body) throw new UserError(`Discord didn't send the file (HTTP ${response.status}). Try again.`);
      await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(path));
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    return this.addFile(guildId, path, attachment.name, uploadedBy);
  }

  /**
   * Adds a file that was saved to the incoming folder (see `incomingPath`): checks it, converts it if needed, and
   * moves it into the server's library. The incoming file is always removed, whether this works or not.
   */
  async addFile(guildId: string, incomingPath: string, originalName: string, uploadedBy: AddedBy): Promise<LibraryFile> {
    const id = randomUUID();
    const convertedPath = `${incomingPath}.ogg`;
    try {
      this.checkFits(guildId, (await stat(incomingPath)).size);

      let probe = await probeAudio(incomingPath);
      let readyPath = incomingPath;
      let extension = playableExtension(probe);
      if (!extension) {
        await convertToOpus(incomingPath, convertedPath);
        // Read the converted file again: it knows its length even when the original didn't say.
        const tags = { title: probe.title, artist: probe.artist };
        probe = { ...(await probeAudio(convertedPath)), ...withoutUndefined(tags) };
        readyPath = convertedPath;
        extension = "ogg";
      }
      if (probe.durationMs === null) throw new UserError("Couldn't work out how long that file is, so it can't be added.");

      const sizeBytes = (await stat(readyPath)).size;
      // Converting can make a file bigger, and other uploads may have finished meanwhile: check the space again.
      this.checkFits(guildId, sizeBytes);

      const fileName = `${id}.${extension}`;
      await mkdir(guildLibraryDir(guildId), { recursive: true });
      await rename(readyPath, libraryFilePath(guildId, fileName));

      const file: StoredLibraryFile = {
        id,
        guildId,
        fileName,
        originalName: cleanOriginalName(originalName),
        title: (probe.title ?? titleFromFileName(originalName)).slice(0, MAX_TITLE_LENGTH),
        artist: probe.artist?.slice(0, MAX_TITLE_LENGTH),
        durationMs: probe.durationMs,
        sizeBytes,
        uploadedBy: { id: uploadedBy.id, name: uploadedBy.name },
        createdAt: Date.now(),
      };
      this.store.add(file);
      console.log(`[library] ${uploadedBy.name} added "${file.title}" (${formatBytes(sizeBytes)}, ${extension}) in ${guildId}`);
      this.emit("change", guildId);
      return toPublicFile(file);
    } finally {
      await rm(incomingPath, { force: true });
      await rm(convertedPath, { force: true });
    }
  }

  /** Deletes a file from the server's library. Songs already queued from it fail with a message when their turn comes. */
  async delete(guildId: string, fileId: string): Promise<LibraryFile> {
    const file = this.store.get(guildId, fileId);
    if (!file) throw new UserError("That file isn't in the library any more.");

    this.store.delete(guildId, fileId);
    this.emit("change", guildId);
    // Windows doesn't let a file be deleted while it's open, and Lavalink keeps it open while it plays. Then the
    // file stays until the next start, when `cleanUp` deletes every file the database no longer knows.
    await rm(libraryFilePath(guildId, file.fileName), { force: true }).catch((error: unknown) => {
      console.warn(`[library] couldn't delete ${file.fileName} yet (${(error as Error).message}); it goes on the next start`);
    });
    return toPublicFile(file);
  }

  // ---------------------------------------------------------------------------------------------
  // Playing (DJs)
  // ---------------------------------------------------------------------------------------------

  /** Queues a library file, joining the requester's voice channel if needed. Returns the item and its position. */
  async play(
    guildId: string,
    fileId: string,
    request: VoiceRequest & { requestedBy: Requester },
  ): Promise<{ item: QueueItem; position: number }> {
    const file = this.get(guildId, fileId);
    const item: QueueItem = {
      id: randomUUID(), // a new queue item each time; the same file can be queued twice
      source: { kind: "file", fileId: file.id },
      title: file.title,
      author: file.artist,
      durationMs: file.durationMs,
      isStream: false,
      requestedBy: request.requestedBy,
    };
    const { position } = await this.players.playItem(guildId, item, request);
    return { item, position };
  }

  // ---------------------------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------------------------

  /**
   * Called once at startup: empties the incoming folder (uploads a crash interrupted), and deletes files the
   * database doesn't know (deleted while Lavalink still had them open, see `delete`).
   */
  async cleanUp(): Promise<void> {
    await rm(INCOMING_DIR, { recursive: true, force: true });
    const known = this.store.allFileNames();
    const folders = await readdir(LIBRARY_DIR, { withFileTypes: true }).catch(() => []);
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const knownFiles = known.get(folder.name) ?? new Set<string>();
      for (const fileName of await readdir(guildLibraryDir(folder.name))) {
        if (!knownFiles.has(fileName)) await rm(libraryFilePath(folder.name, fileName), { force: true });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private quotaBytes(): number {
    return this.settings.global().guildQuotaMb * 1024 * 1024;
  }

  /** Throws if a file of this size is too big for one upload, or doesn't fit in the server's remaining space. */
  private checkFits(guildId: string, sizeBytes: number): void {
    const maxUpload = this.maxUploadBytes();
    if (sizeBytes > maxUpload) {
      throw new UserError(`That file is ${formatBytes(sizeBytes)}; files can be at most ${formatBytes(maxUpload)}.`);
    }
    const free = this.quotaBytes() - this.store.usedBytes(guildId);
    if (sizeBytes > free) {
      throw new UserError(
        `The library is full: ${formatBytes(Math.max(0, free))} left, and that file is ${formatBytes(sizeBytes)}. ` +
          "Delete some files first.",
      );
    }
  }
}

/** The extension to save a file with if Lavalink can play it as it is, or null if it must be converted. */
function playableExtension(probe: AudioProbe): string | null {
  // Video files are converted even when their sound could play: that leaves the video out, saving a lot of space.
  if (probe.hasVideo) return null;
  const match = PLAYABLE_AS_IS.find((format) => format.container === probe.container && format.codecs.includes(probe.codec));
  return match?.extension ?? null;
}

/** "My Song (Live).flac" → "My Song (Live)". Underscores often stand for spaces in file names. */
function titleFromFileName(name: string): string {
  const baseName = cleanOriginalName(name);
  const extension = extname(baseName);
  const withoutExtension = extension ? baseName.slice(0, -extension.length) : baseName;
  return withoutExtension.replace(/_/g, " ").trim() || "Untitled";
}

/** The uploaded name, only for showing: no folders, no control characters, not absurdly long. */
function cleanOriginalName(name: string): string {
  const baseName = name.split(/[\\/]/).at(-1) ?? "";
  return baseName.replace(/\p{Cc}/gu, "").slice(0, 255) || "upload";
}

function matchesSearch(file: LibraryFile, wanted: string): boolean {
  if (wanted === "") return true;
  return [file.title, file.artist ?? "", file.originalName].some((text) => text.toLowerCase().includes(wanted));
}

/** A stored file without the parts only the bot needs (where it is on disk). */
function toPublicFile({ guildId: _guildId, fileName: _fileName, ...file }: StoredLibraryFile): LibraryFile {
  return file;
}

function withoutUndefined<T extends object>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}
