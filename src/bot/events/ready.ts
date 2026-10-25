import { type Client, Events, InteractionContextType } from "discord.js";
import type { LavalinkManager } from "lavalink-client";
import type { Config } from "../../config.js";
import { commands } from "../commands/index.js";

export function registerReady(client: Client, lavalink: LavalinkManager, config: Config): void {
  client.once(Events.ClientReady, async (ready) => {
    console.log(`[bot] logged in as ${ready.user.tag} (${ready.guilds.cache.size} servers)`);
    await lavalink.init({ id: ready.user.id, username: ready.user.username });

    // Bulk-overwrite the slash commands on every start so Discord always matches the code.
    const body = commands.map((c) => ({ ...c.data.toJSON(), contexts: [InteractionContextType.Guild] }));
    try {
      if (config.DEV_GUILD_ID) {
        await ready.application.commands.set(body, config.DEV_GUILD_ID);
        console.log(`[bot] registered ${body.length} commands in server ${config.DEV_GUILD_ID}`);
      } else {
        await ready.application.commands.set(body);
        console.log(`[bot] registered ${body.length} global commands`);
      }
    } catch (error) {
      console.error("[bot] failed to register slash commands:", error);
    }
  });
}
