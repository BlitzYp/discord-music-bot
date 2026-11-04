/**
 * Ducking: turning the music down while another bot talks in the same voice channel (Jarvis, through
 * POST /api/guilds/:id/player/duck), and back up when it's done. See `GuildPlayer.setDucked()`.
 */

/** How loud the music is while ducked, compared to before: quiet enough to talk over, still there. */
export const DUCK_FACTOR = 0.3;

/**
 * Ducking ends by itself after this long, so the music never stays quiet if the other bot crashes or
 * forgets to say it's done. Jarvis repeats "duck" every 10 s while it keeps talking.
 */
export const DUCK_SAFETY_MS = 20_000;

/** The player volume while ducked, given the volume before. Lavalink wants a whole number. */
export function duckedVolume(volume: number): number {
  return Math.round(volume * DUCK_FACTOR);
}
