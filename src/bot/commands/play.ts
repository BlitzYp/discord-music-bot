import { SlashCommandBuilder } from "discord.js";
import { formatItem } from "../format.js";
import type { Command } from "./types.js";

export const play: Command = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a link or add it to the queue")
    .addStringOption((o) =>
      o.setName("query").setDescription("YouTube, SoundCloud, Bandcamp, Twitch or direct audio link").setRequired(true),
    ),

  async execute(interaction, { players }) {
    // Loading a track can take longer than Discord's 3-second limit.
    await interaction.deferReply();
    const { item, position } = await players.play(interaction.guildId, {
      input: interaction.options.getString("query", true),
      requestedBy: { id: interaction.user.id, name: interaction.member.displayName, via: "discord" },
      voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
      textChannelId: interaction.channelId,
    });
    await interaction.editReply(
      position === 0 ? `Now playing ${formatItem(item)}` : `Queued at #${position}: ${formatItem(item)}`,
    );
  },
};
