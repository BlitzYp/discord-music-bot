import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const pause: Command = {
  permission: "dj",
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause the current track"),

  async execute(interaction, { players }) {
    await players.pause(interaction.guildId);
    await interaction.reply("Paused. Use /resume to continue.");
  },
};
