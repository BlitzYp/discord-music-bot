import { type Guild } from "discord.js";
import { Router } from "express";
import type { GuildSummary } from "../../shared/types.js";
import type { WebContext } from "../server.js";

/**
 * Read-only routes for servers and their playback state.
 * No login yet (milestone 5), so this lists every server the bot is in; the web server only listens on
 * localhost until then.
 */
export function guildRoutes({ client, players }: WebContext): Router {
  const router = Router();

  router.get("/guilds", (_req, res) => {
    const guilds: GuildSummary[] = client.guilds.cache.map(toSummary);
    guilds.sort((a, b) => a.name.localeCompare(b.name));
    res.json(guilds);
  });

  router.get("/guilds/:id/state", (req, res) => {
    if (!client.guilds.cache.has(req.params.id)) {
      res.status(404).json({ error: "The bot isn't in that server." });
      return;
    }
    res.json(players.getState(req.params.id));
  });

  return router;
}

function toSummary(guild: Guild): GuildSummary {
  return { id: guild.id, name: guild.name, iconUrl: guild.iconURL({ size: 64 }) };
}
