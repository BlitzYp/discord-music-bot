import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { type Loudness, parseLoudness } from "./loudness.js";

/**
 * Running ffmpeg to measure a song's loudness (EBU R128, the standard Spotify and YouTube use). The maths and the
 * reading of ffmpeg's output are in ./loudness.ts; remembering results is ./LoudnessCache.ts.
 */

/** Where ffmpeg reads a song from: a file on this computer, or a link (downloaded here and handed to ffmpeg). */
export type AudioInput =
  | { kind: "file"; path: string }
  | { kind: "link"; url: string; headers?: Record<string, string> };

/** Only the start of very long songs (mixes, podcasts) is measured, so measuring never takes long. */
const MAX_MEASURED_SECONDS = 600;
/** ffmpeg is stopped after this long; the song then plays unadjusted. A whole song usually takes about 1 second. */
const MEASURE_TIMEOUT_MS = 30_000;

/**
 * Measures how loud a song is. Returns null when it can't be measured (the input isn't audio, it's silent, or
 * ffmpeg isn't installed); throws when downloading it failed, so the cache tries again next time.
 */
export async function measureLoudness(input: AudioInput): Promise<Loudness | null> {
  const signal = AbortSignal.timeout(MEASURE_TIMEOUT_MS);
  // A link is downloaded here rather than by ffmpeg, so headers (the Lavalink password) stay out of its command line.
  const download = input.kind === "link" ? await fetchAudio(input, signal) : null;
  const source = input.kind === "file" ? input.path : "pipe:0";

  const ffmpeg = spawn(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-t", String(MAX_MEASURED_SECONDS), "-i", source, "-vn",
     "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
    { signal, stdio: [download ? "pipe" : "ignore", "ignore", "pipe"] },
  );

  let output = "";
  ffmpeg.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  if (download) {
    // ffmpeg stops reading after MAX_MEASURED_SECONDS; the rest of the download is then thrown away.
    ffmpeg.stdin!.on("error", () => {});
    // fetch()'s body is typed as the browser's ReadableStream; at run time it's Node's own, which fromWeb takes.
    Readable.fromWeb(download as NodeReadableStream).on("error", () => {}).pipe(ffmpeg.stdin!);
  }

  return new Promise((resolve) => {
    ffmpeg.on("error", (error) => {
      // ffmpeg missing (ENOENT) or stopped by the timeout: nothing measured, the song plays unadjusted.
      console.warn(`[loudness] ffmpeg couldn't measure the song: ${error.message}`);
      resolve(null);
    });
    ffmpeg.on("close", () => resolve(parseLoudness(output)));
  });
}

async function fetchAudio(input: Extract<AudioInput, { kind: "link" }>, signal: AbortSignal) {
  const response = await fetch(input.url, { headers: input.headers, signal });
  if (!response.ok || !response.body) throw new Error(`downloading the song for measuring failed (HTTP ${response.status})`);
  return response.body;
}
