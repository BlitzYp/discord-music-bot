import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const stop: Command = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback, clear the queue and leave the voice channel"),

  async execute(interaction, { players }) {
    const stopped = await players.stop(interaction.guildId);
    await interaction.reply(stopped ? "Stopped and cleared the queue." : "Nothing is playing.");
  },
};
