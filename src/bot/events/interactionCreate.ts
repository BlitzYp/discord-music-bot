import { type Client, Events, MessageFlags } from "discord.js";
import { hasLevel, LEVEL_NAMES, levelOf, voiceChannelProblem } from "../../permissions.js";
import { UserError } from "../../player/errors.js";
import { commandsByName } from "../commands/index.js";
import type { CommandContext } from "../commands/types.js";

export function registerInteractionCreate(client: Client, ctx: CommandContext): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = commandsByName.get(interaction.commandName);
    if (!command) return;
    if (!interaction.inCachedGuild()) {
      await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    // Discord sends the member (with roles and permissions) along with the command, so this is always current.
    const level = levelOf(interaction.member, ctx.settings);
    if (!hasLevel(level, command.permission)) {
      let content = `You need to be ${LEVEL_NAMES[command.permission]} to use /${command.data.name}.`;
      const noDjRole = ctx.settings.guild(interaction.guildId).djRoleId === null;
      if (command.permission === "dj" && noDjRole) {
        content += " This server has no DJ role yet: a server admin can pick one on the bot's website, under Settings.";
      }
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    if (command.permission === "dj") {
      const problem = voiceChannelProblem(interaction.guild, interaction.user.id, level, ctx.settings);
      if (problem) {
        await interaction.reply({ content: problem, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    try {
      await command.execute(interaction, ctx);
    } catch (error) {
      if (!(error instanceof UserError)) console.error(`[bot] /${interaction.commandName} failed:`, error);
      const content = error instanceof UserError ? error.message : "Something went wrong. Check the bot's console.";
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(content);
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      } catch {
        // The interaction may have expired; nothing more to do.
      }
    }
  });
}
