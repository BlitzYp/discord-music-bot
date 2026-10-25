import type { Player } from "lavalink-client";
import { type AudioFilter, TIMESCALES } from "../shared/filters.js";

/**
 * Replaces whatever filter is active with `filter`. Lavalink keeps filters on the player, so the effect
 * carries over to the following tracks until it's changed or the bot leaves voice.
 * The list of effects and their descriptions live in src/shared/filters.ts.
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
    case "nightcore": {
      const { speed, pitch, rate } = TIMESCALES.nightcore;
      await filters.toggleNightcore(speed, pitch, rate);
      break;
    }
    case "vaporwave": {
      const { speed, pitch, rate } = TIMESCALES.vaporwave;
      await filters.toggleVaporwave(speed, pitch, rate);
      break;
    }
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
