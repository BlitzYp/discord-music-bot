import type { ChatInputCommandInteraction, SharedSlashCommand } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";

export interface CommandContext {
  players: PlayerManager;
}

/** Runs only in servers: `interaction.guildId` is always set. */
export type GuildCommandInteraction = ChatInputCommandInteraction<"cached">;

export interface Command {
  data: SharedSlashCommand;
  execute(interaction: GuildCommandInteraction, ctx: CommandContext): Promise<void>;
}
