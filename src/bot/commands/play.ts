import { SlashCommandBuilder } from "discord.js";
import { isYoutubePlaylistLink } from "../../shared/playlists.js";
import { describeAddMany, escapeMarkdown, formatItem } from "../format.js";
import type { Command } from "./types.js";

export const play: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a link or add it to the queue")
    .addStringOption((o) =>
      o.setName("query").setDescription("YouTube, SoundCloud, Bandcamp, Twitch or direct audio link").setRequired(true),
    )
    .addBooleanOption((o) =>
      o.setName("playlist").setDescription("For a YouTube playlist link: queue every song of the playlist (up to 500)"),
    ),

  async execute(interaction, { players }) {
    // Loading a track can take longer than Discord's 3-second limit.
    await interaction.deferReply();
    const input = interaction.options.getString("query", true);
    const request = {
      input,
      requestedBy: { id: interaction.user.id, name: interaction.member.displayName, via: "discord" as const },
      voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
      textChannelId: interaction.channelId,
    };

    const isPlaylistLink = isYoutubePlaylistLink(input);
    if (isPlaylistLink && interaction.options.getBoolean("playlist")) {
      const { title, result } = await players.playPlaylistLink(interaction.guildId, request);
      await interaction.editReply(`From **${escapeMarkdown(title)}**: ${describeAddMany(result)}`);
      return;
    }

    const { item, position } = await players.play(interaction.guildId, request);
    let reply = position === 0 ? `Now playing ${formatItem(item)}` : `Queued at #${position}: ${formatItem(item)}`;
    if (isPlaylistLink) reply += "\nThat link is from a playlist. To queue all of it, use /play again with `playlist: True`.";
    await interaction.editReply(reply);
  },
};
