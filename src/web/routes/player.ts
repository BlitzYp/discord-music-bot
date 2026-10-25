import { Router } from "express";
import { UserError } from "../../player/errors.js";
import { AUDIO_FILTERS, type AudioFilter } from "../../shared/filters.js";
import { route } from "../http.js";
import type { WebContext } from "../server.js";

/**
 * Playback controls for the website. Like slash commands, these only call PlayerManager.
 *
 * Milestone 5 must put login and the DJ-role check in front of these routes. Until then they're only safe
 * because the web server listens on localhost.
 */
export function playerRoutes({ client, players }: WebContext): Router {
  const router = Router();

  router.post(
    "/guilds/:id/player/filter",
    route(async (req, res) => {
      const guildId = req.params.id as string;
      if (!client.guilds.cache.has(guildId)) throw new UserError("The bot isn't in that server.");

      const filter = req.body?.filter;
      if (!isAudioFilter(filter)) throw new UserError(`"filter" must be one of: ${AUDIO_FILTERS.join(", ")}.`);

      await players.setFilter(guildId, filter);
      res.json(players.getState(guildId));
    }),
  );

  return router;
}

function isAudioFilter(value: unknown): value is AudioFilter {
  return typeof value === "string" && (AUDIO_FILTERS as readonly string[]).includes(value);
}
