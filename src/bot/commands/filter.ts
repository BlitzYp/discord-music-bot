import { SlashCommandBuilder } from "discord.js";
import { AUDIO_FILTERS, type AudioFilter, FILTER_DESCRIPTIONS } from "../../shared/filters.js";
import type { Command } from "./types.js";

export const filter: Command = {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Add an audio effect like nightcore or bass boost")
    .addStringOption((o) =>
      o
        .setName("effect")
        .setDescription("The effect to use (off removes it)")
        .setRequired(true)
        // Shown in Discord as e.g. "nightcore: Faster and higher-pitched".
        .addChoices(...AUDIO_FILTERS.map((name) => ({ name: `${name}: ${FILTER_DESCRIPTIONS[name]}`, value: name }))),
    ),

  async execute(interaction, { players }) {
    // Discord only allows the choices above, so this cast is safe.
    const effect = interaction.options.getString("effect", true) as AudioFilter;
    await interaction.deferReply(); // applying a filter takes a couple of Lavalink requests
    await players.setFilter(interaction.guildId, effect);
    await interaction.editReply(
      effect === "off" ? "Effects turned off." : `Effect: **${effect}** (${FILTER_DESCRIPTIONS[effect].toLowerCase()}).`,
    );
  },
};
