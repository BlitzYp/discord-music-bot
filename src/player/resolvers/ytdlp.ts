import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UserError } from "../errors.js";

/**
 * Talks to yt-dlp, the backup for links Lavalink can't load or play (mainly YouTube when it blocks
 * Lavalink's plugin, and SoundCloud, which is broken in Lavalink 4.2.2).
 *
 * yt-dlp *downloads* the audio to a file that Lavalink then plays from disk. Handing Lavalink the direct
 * audio URL (`yt-dlp -g`) doesn't work for YouTube: those URLs answer 403 to anything but yt-dlp itself.
 */

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
/** Where downloaded audio is kept. Emptied on every start. */
const DOWNLOAD_DIR = join(PROJECT_ROOT, "data", "ytdlp-cache");
/** How many downloaded files to keep, so looping or re-queuing a song doesn't download it again. */
const MAX_CACHED_DOWNLOADS = 20;
/** How long the result of a metadata lookup is reused for a following download. Its URLs expire after a few hours. */
const INFO_REUSE_MS = 5 * 60_000;
const FORMAT = "bestaudio[acodec=opus]/bestaudio";

/** The fields we use from yt-dlp's JSON output. */
export interface YtDlpInfo {
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number; // seconds
  thumbnail?: string;
  is_live?: boolean;
}

const recentInfo = new Map<string, { json: string; info: YtDlpInfo; fetchedAt: number }>();
/** url → downloaded file path. A Map keeps insertion order, so the first entry is the oldest. */
const downloads = new Map<string, Promise<string>>();

/** Looks up a link's title, duration and so on, without downloading it. */
export async function fetchInfo(url: string): Promise<YtDlpInfo> {
  const cached = recentInfo.get(url);
  if (cached && Date.now() - cached.fetchedAt < INFO_REUSE_MS) return cached.info;

  const json = await runYtDlp(["-f", FORMAT, "-J", "--no-playlist", url]);
  const info = JSON.parse(json) as YtDlpInfo;
  if (info.is_live) throw new UserError("Livestreams can't be played through yt-dlp.");
  recentInfo.set(url, { json, info, fetchedAt: Date.now() });
  return info;
}

/** The fields we use from `yt-dlp --flat-playlist -J`: the playlist's title and one entry per video. */
export interface YtDlpPlaylist {
  title?: string;
  entries?: YtDlpPlaylistEntry[];
}

export interface YtDlpPlaylistEntry {
  url?: string;
  title?: string;
  duration?: number | null; // seconds
  uploader?: string | null;
  channel?: string | null;
  thumbnails?: { url: string; width?: number }[];
}

/**
 * Lists the videos of a playlist (a YouTube playlist, or a video link with `&list=`) without downloading
 * anything. `--flat-playlist` reads only the playlist page, so even a few hundred videos take a few seconds.
 * At most `limit` entries are read.
 */
export async function fetchPlaylist(url: string, limit: number): Promise<YtDlpPlaylist> {
  const json = await runYtDlp(["--flat-playlist", "--playlist-end", String(limit), "-J", url], 120_000);
  return JSON.parse(json) as YtDlpPlaylist;
}

/**
 * Searches YouTube with yt-dlp and returns the best match, or null if nothing was found. The backup for when
 * Lavalink's YouTube plugin can't search. `--flat-playlist` reads only the results page, which takes about 2 s.
 */
export async function searchYoutubeWithYtDlp(query: string): Promise<YtDlpPlaylistEntry | null> {
  // "ytsearch1:" is yt-dlp's own syntax for "the first YouTube result for". execFile passes the query as one
  // argument without a shell, so nothing in it can be read as another option or command.
  const json = await runYtDlp(["--flat-playlist", "-J", `ytsearch1:${query}`]);
  return (JSON.parse(json) as YtDlpPlaylist).entries?.[0] ?? null;
}

/**
 * Downloads a link's audio and returns the file's path. Concurrent and repeated requests for the same
 * link share one download.
 */
export function downloadAudio(url: string): Promise<string> {
  const existing = downloads.get(url);
  if (existing) return existing;

  const download = startDownload(url);
  downloads.set(url, download);
  download.catch(() => downloads.delete(url)); // let a failed download be retried later
  void evictOldDownloads();
  return download;
}

/** Deletes everything downloaded by a previous run. Called once at startup. */
export async function clearDownloads(): Promise<void> {
  await rm(DOWNLOAD_DIR, { recursive: true, force: true });
}

/** Updates yt-dlp to its newest version, because YouTube changes often break old versions. */
export async function updateYtDlp(): Promise<string> {
  const output = await runYtDlp(["-U"], 120_000);
  return output.trim().split("\n").at(-1) ?? "";
}

/** yt-dlp's version (a date like "2026.10.01"), for the owner's Admin page. */
export async function ytDlpVersion(): Promise<string> {
  return (await runYtDlp(["--version"], 15_000)).trim();
}

async function startDownload(url: string): Promise<string> {
  await fetchInfo(url); // fails fast on livestreams, and its result makes the download quicker
  await mkdir(DOWNLOAD_DIR, { recursive: true });

  // Files are named by a random id, never by the video's title.
  const id = randomUUID();
  const args = ["-f", FORMAT, "--no-playlist", "--no-part", "-o", join(DOWNLOAD_DIR, `${id}.%(ext)s`)];

  // Reusing the metadata lookup's result skips yt-dlp's slowest step (reading the YouTube page again).
  const cached = recentInfo.get(url);
  if (cached && Date.now() - cached.fetchedAt < INFO_REUSE_MS) {
    const infoFile = join(DOWNLOAD_DIR, `${id}.info.json`);
    await writeFile(infoFile, cached.json);
    args.push("--load-info-json", infoFile);
  } else {
    args.push(url);
  }

  await runYtDlp(args, 180_000);
  const file = (await readdir(DOWNLOAD_DIR)).find((name) => name.startsWith(id) && !name.endsWith(".info.json"));
  await rm(join(DOWNLOAD_DIR, `${id}.info.json`), { force: true });
  if (!file) throw new UserError("yt-dlp finished, but the downloaded file is missing.");
  return join(DOWNLOAD_DIR, file);
}

/** Keeps at most MAX_CACHED_DOWNLOADS files, deleting the oldest. */
async function evictOldDownloads(): Promise<void> {
  while (downloads.size > MAX_CACHED_DOWNLOADS) {
    const [oldestUrl, oldestDownload] = downloads.entries().next().value!;
    downloads.delete(oldestUrl);
    const path = await oldestDownload.catch(() => null);
    if (path) await rm(path, { force: true });
  }
}

/** The yt-dlp program: the copy from `npm run setup:ytdlp` if present, otherwise one installed system-wide. */
function ytDlpPath(): string {
  const local = join(PROJECT_ROOT, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return existsSync(local) ? local : "yt-dlp";
}

/**
 * Runs yt-dlp and returns what it printed. yt-dlp's own error messages (lines starting with "ERROR:")
 * become UserErrors, since they're usually understandable ("Video unavailable").
 */
function runYtDlp(args: string[], timeoutMs = 60_000): Promise<string> {
  // YouTube needs a JavaScript runtime to decode its player. Node.js is already running this bot, so use it.
  const fullArgs = ["--js-runtimes", `node:${process.execPath}`, "--no-warnings", ...args];

  return new Promise((resolvePromise, reject) => {
    execFile(ytDlpPath(), fullArgs, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolvePromise(stdout);

      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(new UserError("yt-dlp isn't installed. Run `npm run setup:ytdlp`."));
      }
      const ytDlpError = stderr
        .split("\n")
        .find((line) => line.startsWith("ERROR:"))
        ?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, ""); // "ERROR: [youtube] abc: Video unavailable" → "abc: Video unavailable"
      reject(ytDlpError ? new UserError(`yt-dlp: ${ytDlpError}`) : error);
    });
  });
}
