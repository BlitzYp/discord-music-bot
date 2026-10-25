import type { Player } from "lavalink-client";
import type { AudioFilter } from "../shared/types.js";

/** What each filter sounds like, for command descriptions and replies. */
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
 * Replaces whatever filter is active with `filter`. Lavalink keeps filters on the player, so the effect
 * carries over to the following tracks until it's changed or the bot leaves voice.
 */
export async function applyFilter(player: Player, filter: AudioFilter): Promise<void> {
  const filters = player.filterManager;

  // Start from a clean slate: resetFilters() clears every effect except the equalizer, which needs clearEQ().
  await filters.resetFilters();
  await filters.clearEQ();

  // lavalink-client's helpers are toggles; after the reset above, each one switches its effect on.
  switch (filter) {
    case "off":
      break;
    case "nightcore":
      await filters.toggleNightcore();
      break;
    case "vaporwave":
      await filters.toggleVaporwave();
      break;
    case "bassboost":
      await filters.setEQPreset("BassboostMedium");
      break;
    case "8d":
      await filters.toggleRotation();
      break;
    case "karaoke":
      await filters.toggleKaraoke();
      break;
    case "soft":
      await filters.toggleLowPass();
      break;
  }
}
