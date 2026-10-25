import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const shuffle: Command = {
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue (the current track keeps playing)"),

  async execute(interaction, { players }) {
    await players.shuffle(interaction.guildId);
    const { queue } = players.getState(interaction.guildId);
    await interaction.reply(`Shuffled ${queue.length} tracks.`);
  },
};
