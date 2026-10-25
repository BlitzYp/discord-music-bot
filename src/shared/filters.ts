// The audio effects for /filter and the website. Shared, so both list the same effects with the same words.
// How each one is applied lives in src/player/filters.ts.

export const AUDIO_FILTERS = ["off", "nightcore", "vaporwave", "bassboost", "8d", "karaoke", "soft"] as const;
export type AudioFilter = (typeof AUDIO_FILTERS)[number];

/** What each effect sounds like, for command choices, replies and the website. */
export const FILTER_DESCRIPTIONS: Record<AudioFilter, string> = {
  off: "No effects",
  nightcore: "Faster and higher-pitched",
  vaporwave: "Slower and lower-pitched",
  bassboost: "Stronger bass",
  "8d": "Sound slowly circles around your head (best with headphones)",
  karaoke: "Tries to remove the vocals",
  soft: "Muffled, as if from another room",
};

/**
 * Settings for the effects that change playback speed (Lavalink's "timescale" filter). These are
 * lavalink-client's defaults, written out so the website can move its progress bar at the right speed.
 * `speed` changes tempo, `pitch` changes pitch, `rate` changes both.
 */
export const TIMESCALES = {
  nightcore: { speed: 1.29, pitch: 1.29, rate: 0.9366 },
  vaporwave: { speed: 0.85, pitch: 0.8, rate: 1 },
} as const;

/** How many seconds of the song play per real second with this effect (1 = normal). */
export function playbackRate(filter: AudioFilter): number {
  if (filter === "nightcore" || filter === "vaporwave") {
    const { speed, rate } = TIMESCALES[filter];
    return speed * rate;
  }
  return 1;
}
