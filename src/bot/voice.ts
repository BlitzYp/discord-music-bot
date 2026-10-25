import type { Guild } from "discord.js";

/** People in a voice channel, not counting bots (including this one). */
export function countListeners(guild: Guild, channelId: string): number {
  let count = 0;
  for (const voiceState of guild.voiceStates.cache.values()) {
    if (voiceState.channelId !== channelId) continue;
    // If the member isn't cached we can't tell whether it's a bot; count it, so the bot never leaves a real person.
    const isBot = voiceState.member?.user.bot ?? false;
    if (!isBot) count++;
  }
  return count;
}
