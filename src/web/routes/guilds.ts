import { Router } from "express";
import { getPermissionLevel } from "../../permissions.js";
import type { GuildSummary } from "../../shared/types.js";
import { requireGuildAccess, requireUser } from "../access.js";
import { route } from "../http.js";
import type { WebContext } from "../server.js";

/** Read-only routes: the servers the user can see, and their playback state. */
export function guildRoutes({ client, players, settings }: WebContext): Router {
  const router = Router();

  /** Servers that both the logged-in user and the bot are in, with what the user may do in each. */
  router.get(
    "/guilds",
    route(async (req, res) => {
      const user = requireUser(req);
      const guilds = [...client.guilds.cache.values()];
      const levels = await Promise.all(guilds.map((guild) => getPermissionLevel(guild, user.id, settings)));

      const visible: GuildSummary[] = [];
      guilds.forEach((guild, index) => {
        const level = levels[index];
        if (level) visible.push({ id: guild.id, name: guild.name, iconUrl: guild.iconURL({ size: 64 }), level });
      });
      visible.sort((a, b) => a.name.localeCompare(b.name));
      res.json(visible);
    }),
  );

  router.get(
    "/guilds/:id/state",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, { client, settings }, "member");
      res.json(players.getState(guild.id));
    }),
  );

  return router;
}
