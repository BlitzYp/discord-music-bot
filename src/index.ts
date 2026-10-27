import { config } from "./config.js";
import { createClient } from "./bot/client.js";
import { registerInteractionCreate } from "./bot/events/interactionCreate.js";
import { registerPlayerEvents } from "./bot/events/playerEvents.js";
import { registerReady } from "./bot/events/ready.js";
import { registerVoiceStateUpdate } from "./bot/events/voiceStateUpdate.js";
import { registerPresence } from "./bot/presence.js";
import { openDatabase } from "./db/database.js";
import { LibraryStore } from "./db/libraryStore.js";
import { PlayerStateStore } from "./db/playerStateStore.js";
import { PlaylistStore } from "./db/playlistStore.js";
import { SettingsStore } from "./db/settingsStore.js";
import { LibraryManager } from "./library/LibraryManager.js";
import { createLavalink } from "./player/lavalink.js";
import { LoudnessCache } from "./player/LoudnessCache.js";
import { MemberAnnouncements } from "./player/MemberAnnouncements.js";
import { PlayerManager } from "./player/PlayerManager.js";
import { clearDownloads, updateYtDlp } from "./player/resolvers/ytdlp.js";
import { PlaylistManager } from "./playlists/PlaylistManager.js";
import { clearSpeechFiles } from "./tts/speech.js";
import { startWebServer } from "./web/server.js";

// Startup order: config → db → Lavalink → bot → web
const db = openDatabase();
const settings = new SettingsStore(db);

await clearDownloads();
await clearSpeechFiles();
if (settings.global().ytdlpAutoUpdate) {
  // YouTube changes often break old yt-dlp versions. Updating runs in the background so startup isn't delayed.
  updateYtDlp()
    .then((result) => console.log(`[yt-dlp] ${result}`))
    .catch((error) => console.warn(`[yt-dlp] couldn't update: ${error instanceof Error ? error.message : error}`));
}

const client = createClient();
const lavalink = createLavalink(client, config);
const libraryStore = new LibraryStore(db);
// Loads the queues saved before the last shutdown (see PlayerManager's constructor).
const players = new PlayerManager(lavalink, settings, new PlayerStateStore(db), libraryStore, new LoudnessCache(db));
const playlists = new PlaylistManager(new PlaylistStore(db), players);
const library = new LibraryManager(libraryStore, settings, players);
await library.cleanUp();

// Lavalink needs Discord's voice state and voice server updates to join channels.
client.on("raw", (packet) => void lavalink.sendRawData(packet));

registerReady(client, lavalink, players, config);
registerInteractionCreate(client, { players, playlists, library, settings });
registerPlayerEvents(client, players, settings);
registerVoiceStateUpdate(client, players, new MemberAnnouncements(players, settings));
registerPresence(client, players, settings);

process.on("unhandledRejection", (error) => console.error("[process] unhandled rejection:", error));

async function shutdown(): Promise<void> {
  console.log("Shutting down...");
  // Leaving voice clears each server's queue in memory; the saved copy must stay for the next start.
  players.stopSaving();
  for (const player of lavalink.players.values()) await player.destroy("bot shutting down").catch(() => {});
  await client.destroy();
  db.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await client.login(config.DISCORD_TOKEN);
// The bot keeps working in Discord even if the website can't start (e.g. the port is taken).
await startWebServer({ client, players, playlists, library, settings, config }).catch((error) =>
  console.error("[web] the website couldn't start:", error instanceof Error ? error.message : error),
);
