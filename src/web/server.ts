import { createServer } from "node:http";
import type { Client } from "discord.js";
import express from "express";
import type { PlayerManager } from "../player/PlayerManager.js";
import { serveFrontend } from "./frontend.js";
import { guildRoutes } from "./routes/guilds.js";
import { playerRoutes } from "./routes/player.js";
import { attachSocket } from "./socket.js";

/** What the web layer needs from the rest of the app. */
export interface WebContext {
  client: Client;
  players: PlayerManager;
}

/**
 * Starts the website: the REST API under /api, live updates over Socket.IO, and the React frontend,
 * all on one port.
 *
 * It listens on 127.0.0.1 only, so it's reachable from this computer but not from the network: there's no
 * login until milestone 5.
 */
export async function startWebServer(context: WebContext, port: number): Promise<void> {
  const app = express();
  const httpServer = createServer(app);

  // Request bodies must be JSON. This also stops other websites from changing things through the user's
  // browser: a cross-site form can't send JSON without a CORS check, and this server allows none.
  app.use("/api", express.json());
  app.use("/api", guildRoutes(context));
  app.use("/api", playerRoutes(context));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  attachSocket(httpServer, context);
  await serveFrontend(app);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject); // e.g. the port is already in use
    httpServer.listen(port, "127.0.0.1", resolve);
  });
  console.log(`[web] website running at http://localhost:${port}`);
}
