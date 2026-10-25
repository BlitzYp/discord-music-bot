import { SlashCommandBuilder } from "discord.js";
import { formatItem } from "../format.js";
import { itemAtPosition } from "./positions.js";
import type { Command } from "./types.js";

export const remove: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a track from the queue")
    .addIntegerOption((o) =>
      o.setName("position").setDescription("Its number in /queue").setRequired(true).setMinValue(1),
    ),

  async execute(interaction, { players }) {
    const position = interaction.options.getInteger("position", true);
    const item = itemAtPosition(players.getState(interaction.guildId), position);
    const removed = await players.remove(interaction.guildId, item.id);
    await interaction.reply(`Removed ${formatItem(removed)} from the queue.`);
  },
};
