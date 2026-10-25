import { SlashCommandBuilder } from "discord.js";
import type { LoopMode } from "../../shared/types.js";
import type { Command } from "./types.js";

const DESCRIPTIONS: Record<LoopMode, string> = {
  off: "Looping is off.",
  track: "Looping the current track.",
  queue: "Looping the whole queue: finished tracks go back to the end.",
};

export const loop: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Repeat the current track or the whole queue")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("What to repeat")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "track", value: "track" },
          { name: "queue", value: "queue" },
        ),
    ),

  async execute(interaction, { players }) {
    // Discord only allows the choices above, so this cast is safe.
    const mode = interaction.options.getString("mode", true) as LoopMode;
    await players.setLoopMode(interaction.guildId, mode);
    await interaction.reply(DESCRIPTIONS[mode]);
  },
};
