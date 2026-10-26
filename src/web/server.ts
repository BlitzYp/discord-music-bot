import { createServer } from "node:http";
import type { Client } from "discord.js";
import express from "express";
import type { Config } from "../config.js";
import type { SettingsStore } from "../db/settingsStore.js";
import type { LibraryManager } from "../library/LibraryManager.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import type { PlaylistManager } from "../playlists/PlaylistManager.js";
import { serveFrontend } from "./frontend.js";
import { requireJsonForChanges } from "./http.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { guildRoutes } from "./routes/guilds.js";
import { libraryRoutes } from "./routes/library.js";
import { playerRoutes } from "./routes/player.js";
import { playlistRoutes } from "./routes/playlists.js";
import { settingsRoutes } from "./routes/settings.js";
import { createSessionMiddleware } from "./session.js";
import { attachSocket } from "./socket.js";

/** What the web layer needs from the rest of the app. */
export interface WebContext {
  client: Client;
  players: PlayerManager;
  playlists: PlaylistManager;
  library: LibraryManager;
  settings: SettingsStore;
  config: Config;
}

/**
 * Starts the website: the REST API under /api, live updates over Socket.IO, and the React frontend,
 * all on one port.
 *
 * It listens on 127.0.0.1 only, so the network can't reach it directly. The public URL comes from Tailscale Funnel
 * (`npm run funnel`), which runs on this computer and passes requests on to this port.
 */
export async function startWebServer(context: WebContext): Promise<void> {
  const app = express();
  // Requests from this computer may say they arrived over https (X-Forwarded-Proto): Tailscale Funnel does, for the
  // public URL. Only this computer is trusted to say so; nobody else can connect to 127.0.0.1 anyway.
  app.set("trust proxy", "loopback");
  const httpServer = createServer(app);
  const session = createSessionMiddleware(context.config);

  app.use("/api", session, express.json(), requireJsonForChanges);
  app.use("/api", authRoutes(context.config));
  app.use("/api", guildRoutes(context));
  app.use("/api", playerRoutes(context));
  app.use("/api", playlistRoutes(context));
  app.use("/api", libraryRoutes(context));
  app.use("/api", settingsRoutes(context));
  app.use("/api", adminRoutes(context));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  attachSocket(httpServer, context, session);
  await serveFrontend(app);

  const port = context.config.WEB_PORT;
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject); // e.g. the port is already in use
    httpServer.listen(port, "127.0.0.1", resolve);
  });
  console.log(`[web] website running at http://localhost:${port}`);
}
