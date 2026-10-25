import type { Client } from "discord.js";
import type { SettingsStore } from "../../db/settingsStore.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { summarizeError, UserError } from "../../player/errors.js";
import { formatItem } from "../format.js";

/**
 * Posts in Discord about things that happen after a command already replied:
 * - playback errors (e.g. a queued track failing later), in the channel where playback was started;
 * - "Now playing" for every new song, in the server's announcement channel, if one is set.
 */
export function registerPlayerEvents(client: Client, players: PlayerManager, settings: SettingsStore): void {
  players.on("error", async (guildId, item, error) => {
    const fullMessage = error instanceof Error ? error.message : String(error);
    if (!(error instanceof UserError)) {
      console.error(`[player] ${guildId}: ${item?.title ?? "(no track)"}: ${fullMessage}`);
    }

    const channelId = players.lavalink.getPlayer(guildId)?.textChannelId;
    const reason = summarizeError(fullMessage);
    await send(client, channelId, item ? `Couldn't play ${formatItem(item)}: ${reason}` : `Playback error: ${reason}`);
  });

  /** The last item announced per server. A song on repeat, or retried with yt-dlp, starts again with the same id. */
  const lastAnnounced = new Map<string, string>();
  players.on("track:start", async (guildId, item) => {
    const { announceChannelId } = settings.guild(guildId);
    if (!announceChannelId || lastAnnounced.get(guildId) === item.id) return;
    lastAnnounced.set(guildId, item.id);
    await send(client, announceChannelId, `Now playing ${formatItem(item)} · requested by ${item.requestedBy.name}`);
  });
}

async function send(client: Client, channelId: string | null | undefined, content: string): Promise<void> {
  const channel = channelId ? client.channels.cache.get(channelId) : undefined;
  if (!channel?.isSendable()) return;
  try {
    await channel.send(content);
  } catch {
    // Missing permissions in that channel; nothing more we can do.
  }
}
