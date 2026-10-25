import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const resume: Command = {
  permission: "dj",
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume the paused track"),

  async execute(interaction, { players }) {
    // After a restart this joins the requester's voice channel and reloads the song, which can take a while.
    await interaction.deferReply();
    await players.resume(interaction.guildId, {
      voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
      textChannelId: interaction.channelId,
    });
    await interaction.editReply("Resumed.");
  },
};
