import { type Client, Events, type Guild } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";

/**
 * Whenever someone joins, leaves or moves between voice channels, tells PlayerManager how many people are
 * left in the bot's channel, so it can leave a channel nobody is listening in.
 */
export function registerVoiceStateUpdate(client: Client, players: PlayerManager): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guild = newState.guild;
    const botChannelId = players.getState(guild.id).voiceChannelId;
    if (!botChannelId) return;

    // Only changes involving the bot's channel can change its listener count.
    const affectsBotChannel = oldState.channelId === botChannelId || newState.channelId === botChannelId;
    if (!affectsBotChannel) return;

    players.updateListenerCount(guild.id, countListeners(guild, botChannelId));
  });
}

/** People in a voice channel, not counting bots (including this one). */
function countListeners(guild: Guild, channelId: string): number {
  let count = 0;
  for (const voiceState of guild.voiceStates.cache.values()) {
    if (voiceState.channelId !== channelId) continue;
    // If the member isn't cached we can't tell whether it's a bot; count it, so the bot never leaves a real person.
    const isBot = voiceState.member?.user.bot ?? false;
    if (!isBot) count++;
  }
  return count;
}
