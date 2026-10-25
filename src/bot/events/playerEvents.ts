import type { Client } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { UserError } from "../../player/errors.js";
import { formatItem } from "../format.js";

/** Reports playback errors that happen after a command already replied (e.g. a queued track failing later). */
export function registerPlayerEvents(client: Client, players: PlayerManager): void {
  players.on("error", async (guildId, item, error) => {
    const fullMessage = error instanceof Error ? error.message : String(error);
    if (!(error instanceof UserError)) {
      console.error(`[player] ${guildId}: ${item?.title ?? "(no track)"}: ${fullMessage}`);
    }

    const channelId = players.lavalink.getPlayer(guildId)?.textChannelId;
    const channel = channelId ? client.channels.cache.get(channelId) : undefined;
    if (!channel?.isSendable()) return;

    const reason = summarizeError(fullMessage);
    try {
      await channel.send(item ? `Couldn't play ${formatItem(item)}: ${reason}` : `Playback error: ${reason}`);
    } catch {
      // Missing permissions in that channel; the console log above is enough.
    }
  });
}

/**
 * Turns an error message into one short line for Discord. Lavalink's messages can contain a Java stack trace
 * for every YouTube client it tried; the full text is logged to the console instead.
 */
function summarizeError(message: string): string {
  if (message.includes("All clients failed")) {
    return "YouTube refused to play this video. Details are in the bot's console.";
  }
  const firstLine = message.split("\n")[0]?.trim() || "unknown error";
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}
