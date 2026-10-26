import { SlashCommandBuilder } from "discord.js";
import { formatItem } from "../format.js";
import { itemAtPosition } from "./positions.js";
import type { Command } from "./types.js";

export const playnow: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("playnow")
    .setDescription("Play a queued track right away, skipping the current one")
    .addIntegerOption((o) =>
      o.setName("position").setDescription("The track's number in /queue").setRequired(true).setMinValue(1),
    ),

  async execute(interaction, { players }) {
    const position = interaction.options.getInteger("position", true);
    const item = itemAtPosition(players.getState(interaction.guildId), position);
    // Starting a track can take a moment (loading it, or a yt-dlp download), longer than Discord's 3 seconds.
    await interaction.deferReply();
    await players.playNow(interaction.guildId, item.id);
    // If the track couldn't be loaded, the error was already posted and the next one started instead.
    const { current, interrupted } = players.getState(interaction.guildId);
    // After a restart the bot isn't in voice yet, so the track only becomes the one /resume continues.
    if (current?.id === item.id && interrupted) await interaction.editReply(`${formatItem(current)} is up now. Use /resume to start it.`);
    else if (current?.id === item.id) await interaction.editReply(`Now playing ${formatItem(current)}`);
    else await interaction.editReply(`Couldn't play ${formatItem(item)}.` + (current ? `\nNow playing ${formatItem(current)}` : ""));
  },
};
