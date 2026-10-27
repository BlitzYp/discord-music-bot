import { type Client, Events } from "discord.js";
import type { MemberAnnouncements } from "../../player/MemberAnnouncements.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { countListeners } from "../voice.js";

/**
 * Whenever someone joins, leaves or moves between voice channels:
 * - tells PlayerManager how many people are left in the bot's channel, so it can leave a channel nobody is
 *   listening in;
 * - reports people joining or leaving the bot's channel, for the "welcome" and "bye" announcements.
 */
export function registerVoiceStateUpdate(client: Client, players: PlayerManager, memberAnnouncements: MemberAnnouncements): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guild = newState.guild;
    const botChannelId = players.getState(guild.id).voiceChannelId;
    if (!botChannelId) return;

    // Only changes involving the bot's channel can change its listener count.
    const affectsBotChannel = oldState.channelId === botChannelId || newState.channelId === botChannelId;
    if (!affectsBotChannel) return;

    const listeners = countListeners(guild, botChannelId);
    players.updateListenerCount(guild.id, listeners);

    // Muting, deafening or screen sharing also changes the voice state; only a change of channel counts here.
    // Bots (this one included, when it joins or moves) aren't greeted.
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot || oldState.channelId === newState.channelId) return;
    const person = { id: member.id, name: member.displayName };
    if (newState.channelId === botChannelId) memberAnnouncements.memberJoined(guild.id, person);
    // Saying goodbye to an empty channel would be for nobody.
    else if (listeners > 0) memberAnnouncements.memberLeft(guild.id, person);
  });
}
