import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizationGain, parseLoudness } from "./loudness.js";

// The expected volumes are worked out by hand: a change of N dB multiplies the volume by 10^(N/20).
// The target is -14 LUFS; boosts stop where the song's true peak would pass -1 dBTP, and at +10 dB; cuts stop at -15 dB.

describe("normalizationGain", () => {
  it("leaves a song that's already at the target loudness as it is", () => {
    assert.equal(normalizationGain({ loudnessLufs: -14, truePeakDbtp: -1 }), 1);
  });

  it("turns a loud song down to the target", () => {
    // -8 LUFS is 6 dB too loud: 10^(-6/20) = 0.501
    assertClose(normalizationGain({ loudnessLufs: -8, truePeakDbtp: 0 }), 0.501);
  });

  it("turns a quiet song up to the target when its peaks leave room", () => {
    // -20 LUFS is 6 dB too quiet; peaks at -10 dBTP leave 9 dB of room: 10^(6/20) = 1.995
    assertClose(normalizationGain({ loudnessLufs: -20, truePeakDbtp: -10 }), 1.995);
  });

  it("turns a quiet song up only as far as its peaks allow, so it doesn't distort", () => {
    // 6 dB too quiet, but peaks at -3 dBTP leave only 2 dB before -1 dBTP: 10^(2/20) = 1.259
    assertClose(normalizationGain({ loudnessLufs: -20, truePeakDbtp: -3 }), 1.259);
  });

  it("never turns a quiet song down because of its peaks", () => {
    // 6 dB too quiet, and the peaks are already above -1 dBTP: no boost, but no cut either.
    assert.equal(normalizationGain({ loudnessLufs: -20, truePeakDbtp: 0.5 }), 1);
  });

  it("boosts at most 10 dB, however quiet the song", () => {
    // 26 dB too quiet with plenty of peak room: capped at +10 dB, 10^(10/20) = 3.162
    assertClose(normalizationGain({ loudnessLufs: -40, truePeakDbtp: -30 }), 3.162);
  });

  it("cuts at most 15 dB, however loud the song", () => {
    // 19 dB too loud: capped at -15 dB, 10^(-15/20) = 0.178
    assertClose(normalizationGain({ loudnessLufs: 5, truePeakDbtp: 3 }), 0.178);
  });
});

// The end of what `ffmpeg -af ebur128=peak=true:framelog=quiet` printed for a real song (Rick Astley, measured
// 2026-10-27), stream details included, because the real output has them above the summary.
const SONG_OUTPUT = `
    Metadata:
      encoder         : Lavc63.1.102 pcm_s16le
      handler_name    : ISO Media file produced by Google Inc.
[Parsed_ebur128_0 @ 000001d3b6614580] Summary:

  Integrated loudness:
    I:         -13.1 LUFS
    Threshold: -23.2 LUFS

  Loudness range:
    LRA:         5.0 LU
    Threshold: -33.2 LUFS
    LRA low:   -15.8 LUFS
    LRA high:  -10.8 LUFS

  True peak:
    Peak:       -0.4 dBFS
[out#0/null @ 000001d3b6570940] video:0KiB audio:36708KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=N/A time=00:03:33.08 bitrate=N/A speed= 338x elapsed=0:00:00.63
`;

describe("parseLoudness", () => {
  it("reads the loudness and true peak from ffmpeg's summary", () => {
    assert.deepEqual(parseLoudness(SONG_OUTPUT), { loudnessLufs: -13.1, truePeakDbtp: -0.4 });
  });

  it("gives no result for (near) silence, which ffmpeg reports as -70 LUFS", () => {
    // Real output for very quiet noise (anoisesrc with amplitude 0.0003): too quiet to measure, so nothing to adjust.
    const nearSilence = `
[Parsed_ebur128_0 @ 000001761af56700] Summary:

  Integrated loudness:
    I:         -70.0 LUFS
    Threshold:   0.0 LUFS

  True peak:
    Peak:      -65.2 dBFS
`;
    assert.equal(parseLoudness(nearSilence), null);
  });

  it("gives no result when ffmpeg couldn't read the audio", () => {
    // Real output for a text file named .mp3.
    const failed = `
[in#0 @ 000001911eff3740] Failed to find two consecutive MPEG audio frames.
[in#0 @ 000001911eff3500] Error opening input: Invalid data found when processing input
Error opening input files: Invalid data found when processing input
`;
    assert.equal(parseLoudness(failed), null);
  });
});

/** Volumes are compared to 3 decimals, which is far finer than anyone can hear. */
function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 0.001, `expected about ${expected}, got ${actual}`);
}
