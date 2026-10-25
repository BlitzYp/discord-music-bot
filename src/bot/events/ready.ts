import { setTimeout as sleep } from "node:timers/promises";
import { type Client, Events, InteractionContextType } from "discord.js";
import type { LavalinkManager } from "lavalink-client";
import type { Config } from "../../config.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { commands } from "../commands/index.js";
import { countListeners } from "../voice.js";

export function registerReady(client: Client, lavalink: LavalinkManager, players: PlayerManager, config: Config): void {
  client.once(Events.ClientReady, async (ready) => {
    console.log(`[bot] logged in as ${ready.user.tag} (${ready.guilds.cache.size} servers)`);
    await lavalink.init({ id: ready.user.id, username: ready.user.username });

    // Runs alongside the command registration below; it waits for Lavalink, which may not be running yet.
    void continuePlaybackAfterRestart(ready, lavalink, players);

    try {
      await registerSlashCommands(ready, config);
    } catch (error) {
      console.error("[bot] failed to register slash commands:", error);
    }
  });
}

/**
 * Rejoins the voice channels where songs were playing when the bot stopped, if people are still in them.
 * Discord's voice states are already known here (the "ready" event comes after Discord sent every server).
 */
async function continuePlaybackAfterRestart(client: Client<true>, lavalink: LavalinkManager, players: PlayerManager): Promise<void> {
  await waitForLavalinkSession(lavalink);
  await players.rejoinAfterRestart((guildId, voiceChannelId) => {
    const guild = client.guilds.cache.get(guildId);
    return guild !== undefined && countListeners(guild, voiceChannelId) > 0;
  });
}

/**
 * Waits until a Lavalink node is connected and has a session id; players can't be created before that.
 * lavalink-client's "connect" event can fire just before the session id arrives, so this checks every second.
 */
async function waitForLavalinkSession(lavalink: LavalinkManager): Promise<void> {
  const hasSession = () => [...lavalink.nodeManager.nodes.values()].some((node) => node.connected && node.sessionId);
  while (!hasSession()) await sleep(1000);
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
