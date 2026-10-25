import { SlashCommandBuilder } from "discord.js";
import { formatItem } from "../format.js";
import type { Command } from "./types.js";

export const skip: Command = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),

  async execute(interaction, { players }) {
    await interaction.deferReply();
    const skipped = await players.skip(interaction.guildId);
    if (!skipped) {
      await interaction.editReply("Nothing is playing.");
      return;
    }
    const { current } = players.getState(interaction.guildId);
    await interaction.editReply(
      `Skipped ${formatItem(skipped)}` + (current ? `\nNow playing ${formatItem(current)}` : "\nThe queue is empty."),
    );
  },
};
