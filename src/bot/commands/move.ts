import { SlashCommandBuilder } from "discord.js";
import { formatItem } from "../format.js";
import { itemAtPosition } from "./positions.js";
import type { Command } from "./types.js";

export const move: Command = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different place in the queue")
    .addIntegerOption((o) =>
      o.setName("from").setDescription("The track's current number in /queue").setRequired(true).setMinValue(1),
    )
    .addIntegerOption((o) =>
      o.setName("to").setDescription("Its new number (1 = play next)").setRequired(true).setMinValue(1),
    ),

  async execute(interaction, { players }) {
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    const item = itemAtPosition(players.getState(interaction.guildId), from);
    const moved = await players.move(interaction.guildId, item.id, to);
    await interaction.reply(`Moved ${formatItem(moved)} to #${to}.`);
  },
};
