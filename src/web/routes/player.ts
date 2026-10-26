import { type Request, type Response, Router } from "express";
import { UserError } from "../../player/errors.js";
import { MAX_VOLUME } from "../../player/GuildPlayer.js";
import { AUDIO_FILTERS, type AudioFilter } from "../../shared/filters.js";
import { isYoutubePlaylistLink } from "../../shared/playlists.js";
import type { LoopMode } from "../../shared/types.js";
import { type GuildAccess, requireGuildAccess } from "../access.js";
import { route } from "../http.js";
import type { WebContext } from "../server.js";

const LOOP_MODES: readonly LoopMode[] = ["off", "track", "queue"];

/**
 * Playback controls for the website. Like slash commands, each one only checks permission, reads its input,
 * and calls PlayerManager. Every route answers with the new state; the page also gets it through the socket.
 */
export function playerRoutes({ client, players, library, settings }: WebContext): Router {
  const router = Router();

  /** Registers a DJ-only POST/PATCH/DELETE route for one server. */
  function djRoute(
    method: "post" | "patch" | "delete",
    path: string,
    action: (access: GuildAccess, req: Request) => Promise<unknown>,
  ): void {
    router[method](
      path,
      route(async (req: Request, res: Response) => {
        const access = await requireGuildAccess(req, { client, settings }, "dj");
        await action(access, req);
        res.json(players.getState(access.guild.id));
      }),
    );
  }

  // ---- The queue ----

  // { input } adds one link, or the best YouTube match for a search. With `wholePlaylist: true`, a YouTube playlist link queues every song of the playlist.
  // { fileId } adds a file from the server's library.
  djRoute("post", "/guilds/:id/queue", async ({ guild, user }, req) => {
    const voice = {
      requestedBy: { id: user.id, name: user.name, via: "web" as const },
      // The bot joins the voice channel the user is in, like with /play.
      voiceChannelId: guild.voiceStates.cache.get(user.id)?.channelId ?? null,
      textChannelId: null,
    };
    const fileId = req.body?.fileId;
    if (typeof fileId === "string") {
      await library.play(guild.id, fileId, voice);
      return;
    }

    const input = req.body?.input;
    if (typeof input !== "string" || input.trim() === "") throw new UserError("Type a song to search for, or paste a link.");
    const request = { input, ...voice };
    if (req.body?.wholePlaylist === true) {
      if (!isYoutubePlaylistLink(input)) throw new UserError(`That isn't a YouTube playlist link (one with "list=" in it).`);
      await players.playPlaylistLink(guild.id, request);
    } else {
      await players.play(guild.id, request);
    }
  });

  djRoute("delete", "/guilds/:id/queue/:itemId", ({ guild }, req) => players.remove(guild.id, req.params.itemId as string));

  djRoute("patch", "/guilds/:id/queue/:itemId", ({ guild }, req) => {
    const position = req.body?.position;
    if (!Number.isInteger(position)) throw new UserError('"position" must be a whole number (1 = play next).');
    return players.move(guild.id, req.params.itemId as string, position);
  });

  djRoute("post", "/guilds/:id/queue/shuffle", ({ guild }) => players.shuffle(guild.id));
  djRoute("delete", "/guilds/:id/queue", ({ guild }) => players.clearQueue(guild.id));
  djRoute("delete", "/guilds/:id/history", ({ guild }) => players.clearHistory(guild.id));

  // ---- The player ----

  djRoute("post", "/guilds/:id/player/skip", ({ guild }) => players.skip(guild.id));
  djRoute("post", "/guilds/:id/player/pause", ({ guild }) => players.pause(guild.id));
  // After a restart, resuming joins the voice channel the user is in, like adding a song does.
  djRoute("post", "/guilds/:id/player/resume", ({ guild, user }) =>
    players.resume(guild.id, { voiceChannelId: guild.voiceStates.cache.get(user.id)?.channelId ?? null, textChannelId: null }),
  );
  djRoute("post", "/guilds/:id/player/stop", ({ guild }) => players.stop(guild.id));

  djRoute("post", "/guilds/:id/player/seek", ({ guild }, req) => {
    const positionMs = req.body?.positionMs;
    if (typeof positionMs !== "number") throw new UserError('"positionMs" must be a number of milliseconds.');
    return players.seek(guild.id, positionMs);
  });

  djRoute("post", "/guilds/:id/player/volume", ({ guild }, req) => {
    const volume = req.body?.volume;
    if (!Number.isInteger(volume)) throw new UserError(`"volume" must be a whole number from 0 to ${MAX_VOLUME}.`);
    return players.setVolume(guild.id, volume);
  });

  djRoute("post", "/guilds/:id/player/loop", ({ guild }, req) => {
    const mode = req.body?.mode;
    if (!LOOP_MODES.includes(mode)) throw new UserError(`"mode" must be one of: ${LOOP_MODES.join(", ")}.`);
    return players.setLoopMode(guild.id, mode);
  });

  djRoute("post", "/guilds/:id/player/filter", ({ guild }, req) => {
    const filter = req.body?.filter;
    if (!isAudioFilter(filter)) throw new UserError(`"filter" must be one of: ${AUDIO_FILTERS.join(", ")}.`);
    return players.setFilter(guild.id, filter);
  });

  return router;
}

function isAudioFilter(value: unknown): value is AudioFilter {
  return typeof value === "string" && (AUDIO_FILTERS as readonly string[]).includes(value);
}
