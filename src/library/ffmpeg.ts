import { execFile } from "node:child_process";
import { UserError } from "../player/errors.js";

/**
 * Talks to ffprobe and ffmpeg (installed system-wide, e.g. `winget install Gyan.FFmpeg`). They're only used for
 * library uploads: ffprobe checks that a file really is audio and reads its length and tags, and ffmpeg converts
 * files Lavalink can't play. Playback itself never goes through ffmpeg; Lavalink plays the files.
 */

/** What ffprobe found out about a file. */
export interface AudioProbe {
  /** ffprobe's container name, e.g. "mp3", "flac", "ogg", "mov,mp4,m4a,3gp,3g2,mj2" or "matroska,webm". */
  container: string;
  /** The first audio stream's codec, e.g. "mp3", "aac", "opus" or "pcm_s16le". */
  codec: string;
  /** Whether the file has a real video stream. Album art inside an MP3 or FLAC doesn't count. */
  hasVideo: boolean;
  /** null when the file doesn't say (some raw formats); converting it fills that in. */
  durationMs: number | null;
  title?: string;
  artist?: string;
}

/** The parts of `ffprobe -print_format json -show_format -show_streams` we use. */
interface FfprobeOutput {
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    duration?: string;
    disposition?: { attached_pic?: number };
    tags?: Record<string, string>;
  }[];
}

/**
 * Reads a file's container, audio codec, length and tags. Throws a UserError if it isn't audio, or if ffprobe
 * can't read it at all (a renamed text file, a broken download…).
 */
export async function probeAudio(path: string): Promise<AudioProbe> {
  let output: FfprobeOutput;
  try {
    const json = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], 30_000);
    output = JSON.parse(json) as FfprobeOutput;
  } catch (error) {
    if (error instanceof UserError) throw error; // ffmpeg isn't installed
    throw new UserError("That file isn't audio, or it's damaged: ffmpeg couldn't read it.");
  }

  const streams = output.streams ?? [];
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!audio?.codec_name) throw new UserError("That file has no sound in it: it isn't an audio file.");
  // Album art is stored as a one-frame "video" stream marked as an attached picture.
  const hasVideo = streams.some((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);

  // Tags live on the container for most formats, but on the audio stream for OGG and Opus, and their names'
  // capitals vary ("title", "TITLE"), so both places are read without caring about capitals.
  const tags = lowercaseKeys({ ...audio.tags, ...output.format?.tags });
  const seconds = Number(output.format?.duration ?? audio.duration);

  return {
    container: output.format?.format_name ?? "",
    codec: audio.codec_name,
    hasVideo,
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    title: tags.title?.trim() || undefined,
    artist: (tags.artist ?? tags.album_artist)?.trim() || undefined,
  };
}

/**
 * Converts a file's (first) audio to Opus in an OGG file, which Lavalink can play. Any video is left out.
 * 160 kbit/s Opus sounds the same as the original to the ear, and is more than Discord's voice channels carry.
 */
export async function convertToOpus(inputPath: string, outputPath: string): Promise<void> {
  // Up to 10 minutes: converting takes a few seconds per hour of audio, but a long video is slower to read.
  await run(
    "ffmpeg",
    ["-nostdin", "-v", "error", "-y", "-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "libopus", "-b:a", "160k", "-f", "ogg", outputPath],
    10 * 60_000,
  ).catch((error: unknown) => {
    if (error instanceof UserError) throw error;
    throw new UserError("ffmpeg couldn't convert that file to a format the bot can play.");
  });
}

/** ffmpeg's version (e.g. "9.0.2-full_build-www.gyan.dev"), for the owner's Admin page. */
export async function ffmpegVersion(): Promise<string> {
  const output = await run("ffmpeg", ["-hide_banner", "-version"], 15_000);
  return output.match(/^ffmpeg version (\S+)/)?.[1] ?? output.split("\n")[0]!.trim();
}

/** Runs ffmpeg or ffprobe and returns what it printed. Not being installed becomes a UserError saying how to fix it. */
function run(program: "ffmpeg" | "ffprobe", args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(program, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reject(new UserError("ffmpeg isn't installed on the bot's computer, so files can't be added to the library."));
      }
      // The details are for the console; callers turn this into a message for the user.
      console.warn(`[library] ${program} failed: ${stderr.trim().split("\n").at(-1) ?? error.message}`);
      reject(error);
    });
  });
}

function lowercaseKeys(record: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
}
