import type { Db } from "../db/database.js";
import type { Loudness } from "./loudness.js";

interface LoudnessRow {
  loudness_lufs: number;
  true_peak_dbtp: number;
}

/**
 * Remembers how loud each song is (the `loudness` table), so a song is measured with ffmpeg only the first time
 * it plays, in any server.
 */
export class LoudnessCache {
  /**
   * Measurements still running, by song key. The next song is measured ahead of time; if its turn comes before
   * that finishes, it waits for the same measurement instead of starting a second ffmpeg.
   */
  private readonly running = new Map<string, Promise<Loudness | null>>();

  constructor(private readonly db: Db) {}

  /**
   * The loudness of the song `songKey` names ("youtube:<id>", "file:<id>" or "url:<link>"): the remembered result,
   * or what `measure` finds, which is then remembered.
   */
  loudnessOf(songKey: string, measure: () => Promise<Loudness | null>): Promise<Loudness | null> {
    const remembered = this.remembered(songKey);
    if (remembered) return Promise.resolve(remembered);

    let measuring = this.running.get(songKey);
    if (!measuring) {
      measuring = this.measureAndRemember(songKey, measure).finally(() => this.running.delete(songKey));
      this.running.set(songKey, measuring);
    }
    return measuring;
  }

  private remembered(songKey: string): Loudness | null {
    const row = this.db
      .prepare("SELECT loudness_lufs, true_peak_dbtp FROM loudness WHERE song_key = ?")
      .get(songKey) as LoudnessRow | undefined;
    return row ? { loudnessLufs: row.loudness_lufs, truePeakDbtp: row.true_peak_dbtp } : null;
  }

  private async measureAndRemember(songKey: string, measure: () => Promise<Loudness | null>): Promise<Loudness | null> {
    const loudness = await measure();
    if (loudness) {
      this.db
        .prepare("INSERT OR REPLACE INTO loudness (song_key, loudness_lufs, true_peak_dbtp, measured_at) VALUES (?, ?, ?, ?)")
        .run(songKey, loudness.loudnessLufs, loudness.truePeakDbtp, Date.now());
    }
    return loudness;
  }
}
