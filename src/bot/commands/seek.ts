import { SlashCommandBuilder } from "discord.js";
import { UserError } from "../../player/errors.js";
import { formatDuration } from "../format.js";
import type { Command } from "./types.js";

export const seek: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Jump to a point in the current track")
    .addStringOption((o) => o.setName("time").setDescription('Where to jump to, like "1:30" or "90"').setRequired(true)),

  async execute(interaction, { players }) {
    const positionMs = parseTime(interaction.options.getString("time", true));
    await players.seek(interaction.guildId, positionMs);
    await interaction.reply(`Jumped to ${formatDuration(positionMs)}.`);
  },
};

/** "90" → 90 s, "1:30" → 1 min 30 s, "1:02:03" → 1 h 2 min 3 s. Returns milliseconds. */
function parseTime(text: string): number {
  const parts = text.trim().split(":");
  const numbers = parts.map(Number);
  const valid = parts.length <= 3 && parts.every((part) => /^\d+$/.test(part));
  if (!valid) throw new UserError('Write the time like "1:30" (minutes:seconds) or "90" (seconds).');
  const seconds = numbers.reduce((total, n) => total * 60 + n, 0);
  return seconds * 1000;
}
