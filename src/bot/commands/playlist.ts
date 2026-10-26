import { EmbedBuilder, SlashCommandBuilder, type SlashCommandStringOption } from "discord.js";
import { hasLevel, levelOf } from "../../permissions.js";
import { MAX_PLAYLIST_NAME_LENGTH, type PlaylistPlayMode } from "../../shared/playlists.js";
import { describeAddMany, escapeMarkdown, formatDuration, formatItem } from "../format.js";
import type { Command, CommandContext as Ctx, GuildCommandInteraction } from "./types.js";

/** How many songs /playlist show lists. */
const SHOWN = 15;

/** The playlist name option, with suggestions of the server's playlists while typing (see `autocomplete`). */
const nameOption = (o: SlashCommandStringOption) =>
  o.setName("name").setDescription("The playlist's name").setRequired(true).setMaxLength(MAX_PLAYLIST_NAME_LENGTH).setAutocomplete(true);

export const playlist: Command = {
  // Each subcommand has its own rule below; this is only the fallback.
  permission: "dj",
  subcommands: {
    list: { permission: "member", controlsPlayback: false },
    show: { permission: "member", controlsPlayback: false },
    // Anyone may add songs, and remove the ones they added (PlaylistManager checks whose song it is).
    add: { permission: "member", controlsPlayback: false },
    remove: { permission: "member", controlsPlayback: false },
    create: { permission: "dj", controlsPlayback: false },
    import: { permission: "dj", controlsPlayback: false },
    save: { permission: "dj", controlsPlayback: false },
    delete: { permission: "dj", controlsPlayback: false },
    play: { permission: "dj", controlsPlayback: true },
  },
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("This server's saved playlists")
    .addSubcommand((s) => s.setName("list").setDescription("Show this server's playlists"))
    .addSubcommand((s) => s.setName("show").setDescription("Show the songs of a playlist").addStringOption(nameOption))
    .addSubcommand((s) =>
      s
        .setName("play")
        .setDescription("Play a playlist (replaces the queue, unless you pick \"add to queue\")")
        .addStringOption(nameOption)
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("Replace the queue (default), or add to the end of it")
            .addChoices({ name: "replace the queue", value: "replace" }, { name: "add to queue", value: "append" }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a song to a playlist")
        .addStringOption(nameOption)
        .addStringOption((o) =>
          o.setName("link").setDescription("A song to search YouTube for, or a YouTube, SoundCloud or other link").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a song from a playlist (DJs: any song; everyone else: songs they added)")
        .addStringOption(nameOption)
        .addIntegerOption((o) =>
          o.setName("position").setDescription("The song's number in /playlist show").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((s) => s.setName("create").setDescription("Create an empty playlist").addStringOption(nameOption))
    .addSubcommand((s) =>
      s
        .setName("import")
        .setDescription("Add a YouTube playlist's songs to a playlist (created if it doesn't exist)")
        .addStringOption(nameOption)
        .addStringOption((o) => o.setName("link").setDescription("A YouTube playlist link (with list= in it)").setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName("save").setDescription("Save the current song and the queue as a new playlist").addStringOption(nameOption),
    )
    .addSubcommand((s) => s.setName("delete").setDescription("Delete a playlist").addStringOption(nameOption)),

  async execute(interaction, ctx) {
    const subcommand = interaction.options.getSubcommand(true);
    switch (subcommand) {
      case "list":
        return listPlaylists(interaction, ctx);
      case "show":
        return showPlaylist(interaction, ctx);
      case "play":
        return playPlaylist(interaction, ctx);
      case "add":
        return addSong(interaction, ctx);
      case "remove":
        return removeSong(interaction, ctx);
      case "create":
        return createPlaylist(interaction, ctx);
      case "import":
        return importPlaylist(interaction, ctx);
      case "save":
        return saveQueue(interaction, ctx);
      case "delete":
        return deletePlaylist(interaction, ctx);
    }
  },

  /** Suggests the server's playlists whose name contains what has been typed so far. */
  async autocomplete(interaction, { playlists }) {
    const typed = interaction.options.getFocused().toLowerCase();
    const matches = playlists
      .list(interaction.guildId)
      .filter((p) => p.name.toLowerCase().includes(typed))
      .slice(0, 25) // Discord's limit
      .map((p) => ({ name: `${p.name} (${p.songCount} ${p.songCount === 1 ? "song" : "songs"})`, value: p.name }));
    await interaction.respond(matches);
  },
};

/** Who is using the command, as playlists record it. */
function userOf(interaction: GuildCommandInteraction) {
  return { id: interaction.user.id, name: interaction.member.displayName };
}

const nameOf = (interaction: GuildCommandInteraction) => interaction.options.getString("name", true);

async function listPlaylists(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  const all = playlists.list(interaction.guildId);
  if (all.length === 0) {
    await interaction.reply("This server has no playlists yet. A DJ can make one with /playlist create or /playlist import.");
    return;
  }
  const lines = all.map(
    (p) => `**${escapeMarkdown(p.name)}** · ${p.songCount} ${p.songCount === 1 ? "song" : "songs"} · ${formatDuration(p.totalDurationMs)}`,
  );
  const embed = new EmbedBuilder()
    .setTitle("Playlists")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: "/playlist show <name> lists the songs" });
  await interaction.reply({ embeds: [embed] });
}

async function showPlaylist(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  const found = playlists.getByName(interaction.guildId, nameOf(interaction));
  const embed = new EmbedBuilder().setTitle(found.name).setColor(0x5865f2);
  if (found.items.length === 0) {
    embed.setDescription("No songs yet. Anyone can add one with /playlist add.");
  } else {
    const lines = found.items.slice(0, SHOWN).map((song, i) => `**${i + 1}.** ${formatItem(song)} · ${escapeMarkdown(song.addedBy.name)}`);
    if (found.items.length > SHOWN) lines.push(`…and ${found.items.length - SHOWN} more (all of them are on the website)`);
    embed.setDescription(lines.join("\n").slice(0, 4000));
  }
  embed.setFooter({
    text: `${found.songCount} ${found.songCount === 1 ? "song" : "songs"} · ${formatDuration(found.totalDurationMs)} · made by ${found.createdBy.name}`,
  });
  await interaction.reply({ embeds: [embed] });
}

async function playPlaylist(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  // The first song is loaded before answering, which can take longer than Discord's 3-second limit.
  await interaction.deferReply();
  // Discord only allows the choices above, so this cast is safe.
  const mode = (interaction.options.getString("mode") ?? "replace") as PlaylistPlayMode;
  const found = playlists.getByName(interaction.guildId, nameOf(interaction));
  const { result } = await playlists.play(interaction.guildId, found.id, mode, {
    requestedBy: { id: interaction.user.id, name: interaction.member.displayName, via: "discord" },
    voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
    textChannelId: interaction.channelId,
  });
  const action = mode === "replace" ? "Playing" : "Added to the queue:";
  await interaction.editReply(`${action} **${escapeMarkdown(found.name)}**. ${describeAddMany(result)}`);
}

async function addSong(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  await interaction.deferReply(); // loading the link's title can take a few seconds
  const found = playlists.getByName(interaction.guildId, nameOf(interaction));
  const song = await playlists.addSong(interaction.guildId, found.id, interaction.options.getString("link", true), {
    ...userOf(interaction),
    via: "discord",
  });
  await interaction.editReply(`Added ${formatItem(song)} to **${escapeMarkdown(found.name)}** (#${found.songCount + 1}).`);
}

async function removeSong(interaction: GuildCommandInteraction, { playlists, settings }: Ctx): Promise<void> {
  const found = playlists.getByName(interaction.guildId, nameOf(interaction));
  const position = interaction.options.getInteger("position", true);
  const song = found.items[position - 1];
  if (!song) {
    await interaction.reply(`**${escapeMarkdown(found.name)}** has ${found.songCount} songs; there's no #${position}.`);
    return;
  }
  const isDj = hasLevel(levelOf(interaction.member, settings), "dj");
  playlists.removeSong(interaction.guildId, found.id, song.id, { id: interaction.user.id, isDj });
  await interaction.reply(`Removed ${formatItem(song)} from **${escapeMarkdown(found.name)}**.`);
}

async function createPlaylist(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  const created = playlists.create(interaction.guildId, nameOf(interaction), userOf(interaction));
  await interaction.reply(
    `Created the playlist **${escapeMarkdown(created.name)}**. Anyone can add songs with /playlist add, or on the website.`,
  );
}

/** Adds a YouTube playlist's songs to the named playlist, creating it first if there's none by that name. */
async function importPlaylist(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  await interaction.deferReply(); // reading a playlist takes a few seconds
  const name = nameOf(interaction);
  const link = interaction.options.getString("link", true);
  const existing = playlists.findByName(interaction.guildId, name);

  const result = existing
    ? await playlists.importInto(interaction.guildId, existing.id, link, userOf(interaction))
    : await playlists.createFromLink(interaction.guildId, name, link, userOf(interaction));

  const verb = existing ? "Added" : "Created";
  let reply = `${verb} **${escapeMarkdown(result.playlist.name)}**: ${result.added} ${result.added === 1 ? "song" : "songs"} imported`;
  if (existing) reply += `, ${result.playlist.songCount} in total`;
  reply += ".";
  if (result.didNotFit > 0) reply += ` ${result.didNotFit} didn't fit: the playlist is full.`;
  await interaction.editReply(reply);
}

async function saveQueue(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  const saved = playlists.saveQueue(interaction.guildId, nameOf(interaction), userOf(interaction));
  await interaction.reply(`Saved the current song and the queue as **${escapeMarkdown(saved.name)}** (${saved.songCount} songs).`);
}

async function deletePlaylist(interaction: GuildCommandInteraction, { playlists }: Ctx): Promise<void> {
  const found = playlists.getByName(interaction.guildId, nameOf(interaction));
  playlists.delete(interaction.guildId, found.id);
  await interaction.reply(`Deleted the playlist **${escapeMarkdown(found.name)}** (${found.songCount} songs).`);
}
