import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./types.js";

export const normalize: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("normalize")
    .setDescription("Play every song at about the same loudness, like Spotify's Normalize volume")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("on or off")
        .setRequired(true)
        .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    ),

  async execute(interaction, { players }) {
    const enabled = interaction.options.getString("mode", true) === "on";
    // Turning it on measures the current song first (about a second).
    await interaction.deferReply();
    await players.setNormalizeVolume(interaction.guildId, enabled);
    await interaction.editReply(
      enabled
        ? "Volume normalization is **on**: every song plays at about the same loudness. Each new song is measured once (about a second)."
        : "Volume normalization is **off**: songs play at their own loudness.",
    );
  },
};
