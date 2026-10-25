import { type Client, Events } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { countListeners } from "../voice.js";

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
