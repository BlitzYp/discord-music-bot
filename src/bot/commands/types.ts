import type { AutocompleteInteraction, ChatInputCommandInteraction, SharedSlashCommand } from "discord.js";
import type { SettingsStore } from "../../db/settingsStore.js";
import type { PermissionLevel } from "../../permissions.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import type { PlaylistManager } from "../../playlists/PlaylistManager.js";

export interface CommandContext {
  players: PlayerManager;
  playlists: PlaylistManager;
  settings: SettingsStore;
}

/** Runs only in servers: `interaction.guildId` is always set. */
export type GuildCommandInteraction = ChatInputCommandInteraction<"cached">;

/** Who may use a command (or one subcommand), and whether it controls playback. */
export interface CommandRule {
  /** Who may use it (see src/permissions.ts). Checked before `execute` runs. */
  permission: PermissionLevel;
  /**
   * Whether it controls playback, so the server's `requireSameVoiceChannel` setting applies to DJs.
   * Editing a playlist doesn't; playing one does.
   */
  controlsPlayback: boolean;
}

export interface Command {
  data: SharedSlashCommand;
  /**
   * Who may use the command (see src/permissions.ts). Checked before `execute` runs. For a "dj" command, the
   * server's `requireSameVoiceChannel` setting applies too.
   */
  permission: PermissionLevel;
  /**
   * For commands with subcommands that need different levels (/playlist add is for everyone, /playlist play for
   * DJs): the rule for each subcommand, by name. A subcommand not listed here follows `permission`.
   */
  subcommands?: Record<string, CommandRule>;
  execute(interaction: GuildCommandInteraction, ctx: CommandContext): Promise<void>;
  /**
   * Suggests values while someone types an option marked `.setAutocomplete(true)` (e.g. playlist names).
   * Discord shows at most 25 suggestions.
   */
  autocomplete?(interaction: AutocompleteInteraction<"cached">, ctx: CommandContext): Promise<void>;
}

/** The rule that applies to this use of the command: its subcommand's rule, or the command's own permission. */
export function ruleFor(command: Command, interaction: GuildCommandInteraction): CommandRule {
  const subcommand = interaction.options.getSubcommand(false);
  const subcommandRule = subcommand ? command.subcommands?.[subcommand] : undefined;
  return subcommandRule ?? { permission: command.permission, controlsPlayback: command.permission === "dj" };
}
