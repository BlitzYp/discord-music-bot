import { type Client, Events, InteractionContextType } from "discord.js";
import type { LavalinkManager } from "lavalink-client";
import type { Config } from "../../config.js";
import { commands } from "../commands/index.js";

export function registerReady(client: Client, lavalink: LavalinkManager, config: Config): void {
  client.once(Events.ClientReady, async (ready) => {
    console.log(`[bot] logged in as ${ready.user.tag} (${ready.guilds.cache.size} servers)`);
    await lavalink.init({ id: ready.user.id, username: ready.user.username });

    try {
      await registerSlashCommands(ready, config);
    } catch (error) {
      console.error("[bot] failed to register slash commands:", error);
    }
  });
}

/**
 * Overwrites the bot's slash commands on every start, so Discord always matches the code.
 *
 * Commands can be registered globally (every server) or in one server (DEV_GUILD_ID, which updates
 * instantly). A command registered in both places shows up twice, so the place that isn't in use is emptied.
 */
async function registerSlashCommands(ready: Client<true>, config: Config): Promise<void> {
  const body = commands.map((c) => ({ ...c.data.toJSON(), contexts: [InteractionContextType.Guild] }));
  const registry = ready.application.commands;

  if (config.DEV_GUILD_ID) {
    await registry.set(body, config.DEV_GUILD_ID);
    await registry.set([]); // remove the global copies
    console.log(`[bot] registered ${body.length} commands in server ${config.DEV_GUILD_ID} only`);
    return;
  }

  await registry.set(body);
  // Remove per-server copies left over from a time DEV_GUILD_ID was set.
  for (const guild of ready.guilds.cache.values()) {
    await registry.set([], guild.id).catch(() => {
      // Missing access in that server: it can't have per-server commands from us either.
    });
  }
  console.log(`[bot] registered ${body.length} global commands`);
}
