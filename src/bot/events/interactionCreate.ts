import { type Client, Events, MessageFlags } from "discord.js";
import { hasLevel, LEVEL_NAMES, levelOf } from "../../permissions.js";
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
    if (!hasLevel(levelOf(interaction.member), command.permission)) {
      const content = `You need to be ${LEVEL_NAMES[command.permission]} to use /${command.data.name}.`;
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
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
