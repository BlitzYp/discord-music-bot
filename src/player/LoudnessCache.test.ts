import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../db/database.js";
import type { Loudness } from "./loudness.js";
import { LoudnessCache } from "./LoudnessCache.js";

const RICK_ASTLEY: Loudness = { loudnessLufs: -13.1, truePeakDbtp: -0.4 };

/** A stand-in for ffmpeg: answers with `result` and counts how often it was asked. */
function fakeMeasurer(result: Loudness | null) {
  const measurer = {
    calls: 0,
    measure: async (): Promise<Loudness | null> => {
      measurer.calls++;
      return result;
    },
  };
  return measurer;
}

describe("LoudnessCache", () => {
  it("measures a song once and remembers the result", async () => {
    const cache = new LoudnessCache(openDatabase(":memory:"));
    const ffmpeg = fakeMeasurer(RICK_ASTLEY);

    const first = await cache.loudnessOf("youtube:dQw4w9WgXcQ", ffmpeg.measure);
    const second = await cache.loudnessOf("youtube:dQw4w9WgXcQ", ffmpeg.measure);

    assert.deepEqual(first, RICK_ASTLEY);
    assert.deepEqual(second, RICK_ASTLEY);
    assert.equal(ffmpeg.calls, 1);
  });

  it("measures once when the same song is asked for again while it's still being measured", async () => {
    // Happens when the next song is measured ahead of time and its turn comes before that finishes.
    const cache = new LoudnessCache(openDatabase(":memory:"));
    const ffmpeg = fakeMeasurer(RICK_ASTLEY);

    const [early, onStart] = await Promise.all([
      cache.loudnessOf("youtube:dQw4w9WgXcQ", ffmpeg.measure),
      cache.loudnessOf("youtube:dQw4w9WgXcQ", ffmpeg.measure),
    ]);

    assert.deepEqual(early, RICK_ASTLEY);
    assert.deepEqual(onStart, RICK_ASTLEY);
    assert.equal(ffmpeg.calls, 1);
  });

  it("tries again next time when measuring failed, instead of remembering the failure", async () => {
    const cache = new LoudnessCache(openDatabase(":memory:"));
    let calls = 0;
    const flakyFfmpeg = async (): Promise<Loudness | null> => {
      calls++;
      if (calls === 1) throw new Error("YouTube didn't answer");
      return RICK_ASTLEY;
    };

    await assert.rejects(cache.loudnessOf("youtube:dQw4w9WgXcQ", flakyFfmpeg), /YouTube didn't answer/);
    assert.deepEqual(await cache.loudnessOf("youtube:dQw4w9WgXcQ", flakyFfmpeg), RICK_ASTLEY);
    assert.equal(calls, 2);
  });

  it("tries again next time when nothing could be measured", async () => {
    const cache = new LoudnessCache(openDatabase(":memory:"));
    const ffmpeg = fakeMeasurer(null);

    assert.equal(await cache.loudnessOf("url:https://example.com/song.mp3", ffmpeg.measure), null);
    assert.equal(await cache.loudnessOf("url:https://example.com/song.mp3", ffmpeg.measure), null);
    assert.equal(ffmpeg.calls, 2);
  });

  it("still knows a song's loudness after the bot restarts", async () => {
    const database = openDatabase(":memory:");
    await new LoudnessCache(database).loudnessOf("youtube:dQw4w9WgXcQ", fakeMeasurer(RICK_ASTLEY).measure);

    const ffmpegAfterRestart = fakeMeasurer(null);
    const afterRestart = await new LoudnessCache(database).loudnessOf("youtube:dQw4w9WgXcQ", ffmpegAfterRestart.measure);

    assert.deepEqual(afterRestart, RICK_ASTLEY);
    assert.equal(ffmpegAfterRestart.calls, 0);
  });
});
