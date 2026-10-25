import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const resume: Command = {
  permission: "dj",
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume the paused track"),

  async execute(interaction, { players }) {
    await players.resume(interaction.guildId);
    await interaction.reply("Resumed.");
  },
};
