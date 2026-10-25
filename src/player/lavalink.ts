import type { Client } from "discord.js";
import { LavalinkManager } from "lavalink-client";
import type { Config } from "../config.js";

/**
 * Creates the connection to the Lavalink server, which does the actual audio playback.
 *
 * Joining voice is a two-way conversation: lavalink-client asks Discord to join through `sendToShard`,
 * and Discord's answers reach Lavalink through `lavalink.sendRawData` (wired up in src/index.ts).
 */
export function createLavalink(client: Client, config: Config): LavalinkManager {
  const lavalink = new LavalinkManager({
    nodes: [
      {
        id: "main",
        host: config.LAVALINK_HOST,
        port: config.LAVALINK_PORT,
        authorization: config.LAVALINK_PASSWORD,
        // Keep retrying forever: Lavalink may start after the bot or be restarted on its own.
        retryAmount: Number.MAX_SAFE_INTEGER,
        retryDelay: 5_000,
      },
    ],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard.send(payload),
    // GuildPlayer owns the queue, so the library must never advance on its own.
    autoSkip: false,
    autoSkipOnResolveError: false,
    playerOptions: {
      onDisconnect: { autoReconnect: false, destroyPlayer: true },
    },
  });

  lavalink.nodeManager
    .on("connect", (node) => console.log(`[lavalink] node "${node.id}" connected`))
    .on("disconnect", (node, reason) =>
      console.warn(`[lavalink] node "${node.id}" disconnected: ${reason.reason ?? reason.code ?? "unknown"}`),
    )
    .on("reconnecting", (node) => console.log(`[lavalink] reconnecting to node "${node.id}"...`))
    .on("error", (node, error) => console.error(`[lavalink] node "${node.id}" error: ${error.message}`));

  return lavalink;
}
