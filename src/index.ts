import { config } from "./config.js";
import { createClient } from "./bot/client.js";
import { registerInteractionCreate } from "./bot/events/interactionCreate.js";
import { registerPlayerEvents } from "./bot/events/playerEvents.js";
import { registerReady } from "./bot/events/ready.js";
import { registerVoiceStateUpdate } from "./bot/events/voiceStateUpdate.js";
import { createLavalink } from "./player/lavalink.js";
import { PlayerManager } from "./player/PlayerManager.js";
import { clearDownloads, updateYtDlp } from "./player/resolvers/ytdlp.js";
import { startWebServer } from "./web/server.js";

// Startup order: config → (db, later) → Lavalink → bot → web
await clearDownloads();
// YouTube changes often break old yt-dlp versions. Updating runs in the background so startup isn't delayed.
// Becomes the owner's "yt-dlp auto-update" setting in milestone 6.
updateYtDlp()
  .then((result) => console.log(`[yt-dlp] ${result}`))
  .catch((error) => console.warn(`[yt-dlp] couldn't update: ${error instanceof Error ? error.message : error}`));

const client = createClient();
const lavalink = createLavalink(client, config);
const players = new PlayerManager(lavalink);

// Lavalink needs Discord's voice state and voice server updates to join channels.
client.on("raw", (packet) => void lavalink.sendRawData(packet));

registerReady(client, lavalink, config);
registerInteractionCreate(client, { players });
registerPlayerEvents(client, players);
registerVoiceStateUpdate(client, players);

process.on("unhandledRejection", (error) => console.error("[process] unhandled rejection:", error));

async function shutdown(): Promise<void> {
  console.log("Shutting down...");
  for (const player of lavalink.players.values()) await player.destroy("bot shutting down").catch(() => {});
  await client.destroy();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await client.login(config.DISCORD_TOKEN);
// The bot keeps working in Discord even if the website can't start (e.g. the port is taken).
await startWebServer({ client, players, config }).catch((error) =>
  console.error("[web] the website couldn't start:", error instanceof Error ? error.message : error),
);
