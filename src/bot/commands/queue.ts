import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { formatDuration, formatItem } from "../format.js";
import type { Command } from "./types.js";

const SHOWN = 10;

export const queue: Command = {
  data: new SlashCommandBuilder().setName("queue").setDescription("Show the current track and what's coming up"),

  async execute(interaction, { players }) {
    const state = players.getState(interaction.guildId);
    if (!state.current && state.queue.length === 0) {
      await interaction.reply("The queue is empty.");
      return;
    }

    const embed = new EmbedBuilder().setTitle("Queue").setColor(0x5865f2);
    if (state.current) {
      embed.addFields({
        name: state.paused ? "Paused" : "Now playing",
        value: `${formatItem(state.current)}\n${formatDuration(state.positionMs)} elapsed · requested by ${state.current.requestedBy.name}`,
      });
      if (state.current.thumbnail) embed.setThumbnail(state.current.thumbnail);
    }

    const footer = [`Volume ${state.volume}%`];
    if (state.loopMode !== "off") footer.push(`Looping ${state.loopMode}`);

    if (state.queue.length > 0) {
      const lines = state.queue.slice(0, SHOWN).map((item, i) => `**${i + 1}.** ${formatItem(item)} · ${item.requestedBy.name}`);
      if (state.queue.length > SHOWN) lines.push(`…and ${state.queue.length - SHOWN} more`);
      embed.addFields({ name: "Up next", value: lines.join("\n").slice(0, 1024) });

      const totalMs = state.queue.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
      footer.unshift(`${state.queue.length} in queue · ${formatDuration(totalMs)} total`);
    }
    embed.setFooter({ text: footer.join(" · ") });

    await interaction.reply({ embeds: [embed] });
  },
};
