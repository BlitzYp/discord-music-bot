import { SlashCommandBuilder } from "discord.js";
import { MAX_VOLUME } from "../../player/GuildPlayer.js";
import type { Command } from "./types.js";

export const volume: Command = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Show or change the volume")
    .addIntegerOption((o) =>
      o
        .setName("percent")
        .setDescription(`0 to ${MAX_VOLUME} (100 is normal). Leave empty to see the current volume.`)
        .setMinValue(0)
        .setMaxValue(MAX_VOLUME),
    ),

  async execute(interaction, { players }) {
    const percent = interaction.options.getInteger("percent");
    if (percent === null) {
      const { volume } = players.getState(interaction.guildId);
      await interaction.reply(`The volume is ${volume}%.`);
      return;
    }
    await players.setVolume(interaction.guildId, percent);
    await interaction.reply(`Volume set to ${percent}%.`);
  },
};
