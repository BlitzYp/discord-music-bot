import type { ChatInputCommandInteraction, SharedSlashCommand } from "discord.js";
import type { SettingsStore } from "../../db/settingsStore.js";
import type { PermissionLevel } from "../../permissions.js";
import type { PlayerManager } from "../../player/PlayerManager.js";

export interface CommandContext {
  players: PlayerManager;
  settings: SettingsStore;
}

/** Runs only in servers: `interaction.guildId` is always set. */
export type GuildCommandInteraction = ChatInputCommandInteraction<"cached">;

export interface Command {
  data: SharedSlashCommand;
  /** Who may use the command (see src/permissions.ts). Checked before `execute` runs. */
  permission: PermissionLevel;
  execute(interaction: GuildCommandInteraction, ctx: CommandContext): Promise<void>;
}
