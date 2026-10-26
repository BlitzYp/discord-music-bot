import { SlashCommandBuilder } from "discord.js";
import { levelOf } from "../../permissions.js";
import { UserError } from "../../player/errors.js";
import { isYoutubePlaylistLink } from "../../shared/playlists.js";
import { isSpotifyCollectionLink } from "../../shared/spotify.js";
import { describeAddMany, escapeMarkdown, formatItem } from "../format.js";
import type { Command, CommandContext, GuildCommandInteraction } from "./types.js";

export const play: Command = {
  permission: "dj",
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a link or an audio file, or add it to the queue")
    .addStringOption((o) =>
      o.setName("query").setDescription("A song to search for, or a YouTube, Spotify, SoundCloud, Bandcamp, Twitch or audio link"),
    )
    .addAttachmentOption((o) =>
      o.setName("file").setDescription("An audio file to play. It's also saved to this server's library."),
    )
    .addBooleanOption((o) =>
      o.setName("playlist").setDescription("YouTube playlist links: queue the whole playlist (up to 500). Spotify albums/playlists always do."),
    ),

  async execute(interaction, ctx) {
    const input = interaction.options.getString("query");
    const hasFile = interaction.options.getAttachment("file") !== null;
    // Both options are optional (Discord can't require "one of the two"), so check here.
    if (!input && !hasFile) throw new UserError("Type a song or paste a link (`query`), or attach a file (`file`).");
    if (input && hasFile) throw new UserError("Give either a song or link, or a file, not both.");
    if (hasFile) return playAttachment(interaction, ctx);

    // Loading a track can take longer than Discord's 3-second limit.
    await interaction.deferReply();
    const request = {
      input: input!,
      requestedBy: requesterOf(interaction),
      ...voiceOf(interaction),
    };

    const isPlaylistLink = isYoutubePlaylistLink(request.input);
    // A Spotify album or playlist has no "this one song" to play instead, so it always queues all of its songs.
    const queueWholePlaylist = (isPlaylistLink && interaction.options.getBoolean("playlist")) || isSpotifyCollectionLink(request.input);
    if (queueWholePlaylist) {
      const { title, result, notes } = await ctx.players.playPlaylistLink(interaction.guildId, request);
      await interaction.editReply([`From **${escapeMarkdown(title)}**: ${describeAddMany(result)}`, ...notes].join(" "));
      return;
    }

    const { item, position } = await ctx.players.play(interaction.guildId, request);
    let reply = position === 0 ? `Now playing ${formatItem(item)}` : `Queued at #${position}: ${formatItem(item)}`;
    if (isPlaylistLink) reply += "\nThat link is from a playlist. To queue all of it, use /play again with `playlist: True`.";
    await interaction.editReply(reply);
  },
};

/**
 * `/play file:`: saves the attachment to the server's library (Discord's links to attachments expire after about a
 * day), then queues it. Saving needs upload permission (the server's setting), on top of being a DJ.
 */
async function playAttachment(interaction: GuildCommandInteraction, { players, library, settings }: CommandContext): Promise<void> {
  const attachment = interaction.options.getAttachment("file", true);
  library.checkCanUpload(interaction.guildId, levelOf(interaction.member, settings));

  // Checking (and maybe converting) the file takes a few seconds.
  await interaction.deferReply();
  const voice = voiceOf(interaction);
  // Join voice first, so "join a voice channel first" doesn't come after the file was saved.
  await players.join(interaction.guildId, voice);

  const file = await library.addAttachment(interaction.guildId, attachment, { id: interaction.user.id, name: interaction.member.displayName });
  const { item, position } = await library.play(interaction.guildId, file.id, { ...voice, requestedBy: requesterOf(interaction) });
  const status = position === 0 ? `Now playing ${formatItem(item)}` : `Queued at #${position}: ${formatItem(item)}`;
  await interaction.editReply(`${status}\nSaved to the library, so it can be played again with /library play.`);
}

function requesterOf(interaction: GuildCommandInteraction) {
  return { id: interaction.user.id, name: interaction.member.displayName, via: "discord" as const };
}

/** The requester's voice channel (to join it) and this text channel (for errors later). */
function voiceOf(interaction: GuildCommandInteraction) {
  return {
    voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
    textChannelId: interaction.channelId,
  };
}
