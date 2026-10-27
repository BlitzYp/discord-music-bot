// Volume normalization: making every song about equally loud, like Spotify's "Normalize volume".
// Each song's loudness is measured once with ffmpeg; the song then plays with a gain that brings it to TARGET_LUFS.

/** How loud a song is, as ffmpeg's EBU R128 analysis reports it. */
export interface Loudness {
  /** Integrated loudness over the whole song, in LUFS (loudness units; -14 is typical for streaming). */
  loudnessLufs: number;
  /** The loudest point of the waveform, in dBTP (decibels below full scale; 0 is the most a file can hold). */
  truePeakDbtp: number;
}

/** The loudness every song is brought to. -14 LUFS is what Spotify and YouTube use. */
const TARGET_LUFS = -14;
/** Boosting is stopped before a song's peaks pass this, so quiet songs with loud moments don't distort. */
const MAX_TRUE_PEAK_DBTP = -1;
/** The most a song is turned up or down, in dB, so a wrong measurement can't make a song painfully loud or silent. */
const MAX_BOOST_DB = 10;
const MAX_CUT_DB = 15;

/**
 * The volume multiplier (1 = unchanged) that brings a song to TARGET_LUFS. Loud songs are turned down; quiet
 * ones are turned up as far as their peaks allow.
 */
export function normalizationGain({ loudnessLufs, truePeakDbtp }: Loudness): number {
  const wantedDb = TARGET_LUFS - loudnessLufs;
  let gainDb: number;
  if (wantedDb > 0) {
    // Turning up: no further than the peak room or the boost limit, and never below 0 (no cut for a quiet song).
    const peakRoomDb = Math.max(0, MAX_TRUE_PEAK_DBTP - truePeakDbtp);
    gainDb = Math.min(wantedDb, peakRoomDb, MAX_BOOST_DB);
  } else {
    gainDb = Math.max(wantedDb, -MAX_CUT_DB);
  }
  return decibelsToMultiplier(gainDb);
}

/**
 * Reads a song's loudness from what `ffmpeg -af ebur128=peak=true` prints (to stderr) when it finishes. Only the
 * summary at the end counts.
 */
export function parseLoudness(ffmpegOutput: string): Loudness | null {
  const summaryStart = ffmpegOutput.lastIndexOf("Summary:");
  if (summaryStart === -1) return null; // ffmpeg stopped before measuring, e.g. the input wasn't audio
  const summary = ffmpegOutput.slice(summaryStart);
  const loudness = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1];
  const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
  if (loudness === undefined || peak === undefined) return null;
  // ffmpeg reports -70 LUFS (its floor) for anything too quiet to measure, e.g. silence; there's nothing to adjust.
  // Real silence also has a peak of "-inf", which the pattern above doesn't match.
  if (Number(loudness) <= SILENCE_LUFS) return null;
  return { loudnessLufs: Number(loudness), truePeakDbtp: Number(peak) };
}

/** What ffmpeg's EBU R128 filter reports when a song is too quiet to measure. */
const SILENCE_LUFS = -70;

/** A change of N dB multiplies the volume by 10^(N/20). */
function decibelsToMultiplier(decibels: number): number {
  return 10 ** (decibels / 20);
}
