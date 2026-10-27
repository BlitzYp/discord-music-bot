import { cleanContent, SlashCommandBuilder } from "discord.js";
import { MAX_ANNOUNCEMENT_LENGTH } from "../../shared/announcements.js";
import { escapeMarkdown } from "../format.js";
import type { Command } from "./types.js";

export const announce: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Say something in the voice channel (text-to-speech). The song pauses for it, then continues.")
    .addStringOption((o) =>
      o.setName("text").setDescription("What the bot should say").setRequired(true).setMaxLength(MAX_ANNOUNCEMENT_LENGTH),
    ),

  async execute(interaction, { players }) {
    // Mentions arrive as codes like <@123456>; read out, they'd be a string of digits. Turn them into names.
    const text = cleanContent(interaction.options.getString("text", true), interaction.channel!);

    // Making the speech and saying it takes a few seconds, longer than Discord's 3-second limit.
    await interaction.deferReply();
    await players.announce(
      interaction.guildId,
      text,
      { id: interaction.user.id, name: interaction.member.displayName, via: "discord" },
      {
        voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
        textChannelId: interaction.channelId,
      },
    );
    await interaction.editReply(`📢 Announced: "${escapeMarkdown(text)}"`);
  },
};
