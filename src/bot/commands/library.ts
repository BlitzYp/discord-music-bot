import { EmbedBuilder, SlashCommandBuilder, type SlashCommandStringOption } from "discord.js";
import { levelOf } from "../../permissions.js";
import { formatBytes, type LibraryFile } from "../../shared/library.js";
import { escapeMarkdown, formatDuration, formatItem } from "../format.js";
import type { Command, CommandContext as Ctx, GuildCommandInteraction } from "./types.js";

/** How many files /library list shows. */
const SHOWN = 15;

/** The file option, with suggestions of the server's files while typing (see `autocomplete`). */
const fileOption = (o: SlashCommandStringOption) =>
  o.setName("file").setDescription("The file's title").setRequired(true).setAutocomplete(true);

export const library: Command = {
  // Each subcommand has its own rule below; this is only the fallback.
  permission: "dj",
  subcommands: {
    list: { permission: "member", controlsPlayback: false },
    play: { permission: "dj", controlsPlayback: true },
    // Who may upload is the server's own setting (DJs by default), checked in `uploadFile`.
    upload: { permission: "member", controlsPlayback: false },
    delete: { permission: "dj", controlsPlayback: false },
  },
  data: new SlashCommandBuilder()
    .setName("library")
    .setDescription("This server's library of uploaded audio files")
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("Show the files in the library")
        .addStringOption((o) => o.setName("search").setDescription("Only files whose title, artist or file name contains this")),
    )
    .addSubcommand((s) => s.setName("play").setDescription("Play a file from the library, or add it to the queue").addStringOption(fileOption))
    .addSubcommand((s) =>
      s
        .setName("upload")
        .setDescription("Save an audio file to the library without playing it")
        .addAttachmentOption((o) => o.setName("file").setDescription("The audio file").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("delete").setDescription("Delete a file from the library").addStringOption(fileOption)),

  async execute(interaction, ctx) {
    switch (interaction.options.getSubcommand(true)) {
      case "list":
        return listFiles(interaction, ctx);
      case "play":
        return playFile(interaction, ctx);
      case "upload":
        return uploadFile(interaction, ctx);
      case "delete":
        return deleteFile(interaction, ctx);
    }
  },

  /** Suggests the server's files whose title, artist or file name contains what has been typed so far. */
  async autocomplete(interaction, { library }) {
    const matches = library
      .search(interaction.guildId, interaction.options.getFocused())
      .slice(0, 25) // Discord's limit
      // The value is the file's id, so two files with the same title can't be mixed up.
      .map((file) => ({ name: describeForSuggestion(file), value: file.id }));
    await interaction.respond(matches);
  },
};

async function listFiles(interaction: GuildCommandInteraction, { library }: Ctx): Promise<void> {
  const search = interaction.options.getString("search") ?? "";
  const overview = library.overview(interaction.guildId);
  const files = library.search(interaction.guildId, search);
  if (overview.files.length === 0) {
    await interaction.reply("The library is empty. Add a file with /play file:, /library upload, or on the website.");
    return;
  }
  if (files.length === 0) {
    await interaction.reply(`No file in the library matches "${escapeMarkdown(search)}".`);
    return;
  }

  const lines = files.slice(0, SHOWN).map((file) => `${formatFile(file)} · ${escapeMarkdown(file.uploadedBy.name)}`);
  if (files.length > SHOWN) lines.push(`…and ${files.length - SHOWN} more (search, or see them all on the website)`);
  const embed = new EmbedBuilder()
    .setTitle(search ? `Library: "${search}"` : "Library")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({
      text: `${overview.files.length} ${overview.files.length === 1 ? "file" : "files"} · ${formatBytes(overview.usedBytes)} of ${formatBytes(overview.quotaBytes)} used · /library play <file> plays one`,
    });
  await interaction.reply({ embeds: [embed] });
}

async function playFile(interaction: GuildCommandInteraction, { library }: Ctx): Promise<void> {
  await interaction.deferReply(); // joining voice and starting the file can take a moment
  const file = library.find(interaction.guildId, interaction.options.getString("file", true));
  const { item, position } = await library.play(interaction.guildId, file.id, {
    requestedBy: { id: interaction.user.id, name: interaction.member.displayName, via: "discord" },
    voiceChannelId: interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
    textChannelId: interaction.channelId,
  });
  await interaction.editReply(position === 0 ? `Now playing ${formatItem(item)}` : `Queued at #${position}: ${formatItem(item)}`);
}

async function uploadFile(interaction: GuildCommandInteraction, { library, settings }: Ctx): Promise<void> {
  library.checkCanUpload(interaction.guildId, levelOf(interaction.member, settings));
  await interaction.deferReply(); // checking (and maybe converting) the file takes a few seconds
  const attachment = interaction.options.getAttachment("file", true);
  const file = await library.addAttachment(interaction.guildId, attachment, { id: interaction.user.id, name: interaction.member.displayName });
  await interaction.editReply(`Saved ${formatFile(file)} to the library. Play it with /library play.`);
}

async function deleteFile(interaction: GuildCommandInteraction, { library }: Ctx): Promise<void> {
  const file = library.find(interaction.guildId, interaction.options.getString("file", true));
  await library.delete(interaction.guildId, file.id);
  await interaction.reply(`Deleted ${formatFile(file)} from the library.`);
}

/** "**Title** – Artist `3:45`". */
function formatFile(file: LibraryFile): string {
  const artist = file.artist ? ` – ${escapeMarkdown(file.artist)}` : "";
  return `**${escapeMarkdown(file.title).slice(0, 100)}**${artist} \`${formatDuration(file.durationMs)}\``;
}

/** "Title – Artist (3:45)", within Discord's 100-character limit for suggestions. */
function describeForSuggestion(file: LibraryFile): string {
  const artist = file.artist ? ` – ${file.artist}` : "";
  const duration = ` (${formatDuration(file.durationMs)})`;
  return `${file.title}${artist}`.slice(0, 100 - duration.length) + duration;
}
