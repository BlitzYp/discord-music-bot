// The library (milestone 8): audio files people upload, kept per server. Types shared by the bot and the website.

import type { AddedBy } from "./playlists.js";

/**
 * Who may upload files to a server's library (a per-server setting):
 * - "dj": DJs (and admins);
 * - "admin": only server admins;
 * - "off": nobody; uploads are turned off.
 */
export const UPLOAD_PERMISSIONS = ["dj", "admin", "off"] as const;
export type UploadPermission = (typeof UPLOAD_PERMISSIONS)[number];

/** One file in a server's library. */
export interface LibraryFile {
  /** A random id. It's also the file's name on disk; the uploaded name is never part of a path. */
  id: string;
  /** From the file's tags, or else its name without the extension. */
  title: string;
  /** From the file's tags, if it has one. */
  artist?: string;
  /** The file's name as uploaded, e.g. "My Song.flac". Only shown, never used as a path. */
  originalName: string;
  durationMs: number;
  /** The size on disk (after converting, if the file had to be converted). */
  sizeBytes: number;
  uploadedBy: AddedBy;
  /** Milliseconds since 1970, like Date.now(). */
  createdAt: number;
}

/** GET /api/guilds/:id/library: the server's files (newest first) and its storage use. */
export interface LibraryOverview {
  files: LibraryFile[];
  /** How much of the server's quota the files use. */
  usedBytes: number;
  /** The owner's per-server quota (`guildQuotaMb`). */
  quotaBytes: number;
  /** The biggest file one upload may be (`maxUploadMb`). */
  maxUploadBytes: number;
  /** The server's setting; the website uses it to show or hide the upload form. */
  uploadPermission: UploadPermission;
}

/**
 * What the website's file picker offers. Anything ffmpeg can read is accepted (the bot checks the file itself),
 * so this only steers the picker towards audio.
 */
export const UPLOAD_ACCEPT = "audio/*,.mp3,.flac,.wav,.ogg,.opus,.m4a,.aac,.webm,.mka,.wma,.aiff,.aif,.alac";

/** "12.3 MB", "1.5 GB", "800 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
