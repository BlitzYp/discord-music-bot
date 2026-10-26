import { type Request, Router } from "express";
import { z } from "zod";
import { hasLevel } from "../../permissions.js";
import { MAX_PLAYLIST_NAME_LENGTH } from "../../shared/playlists.js";
import { requireGuildAccess } from "../access.js";
import { HttpError, parseBody, route } from "../http.js";
import type { WebContext } from "../server.js";

const name = z.string().trim().min(1, "give the playlist a name").max(MAX_PLAYLIST_NAME_LENGTH);
const link = z.string().trim().min(1, "paste a link");
/** A song to add: a link, or words to search YouTube for. */
const song = z.string().trim().min(1, "type a song or paste a link");

/**
 * POST /playlists: a new empty playlist ({ name }), or one imported from a YouTube playlist or a Spotify album or
 * playlist ({ importUrl }, with an optional name; without one it's named after the linked playlist).
 */
const createBody = z
  .object({ name: name.optional(), importUrl: link.optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.importUrl !== undefined, "Give the playlist a name.");
/**
 * POST /playlists/:playlistId/items: one song ({ input }: a link or a search), or every song of a YouTube playlist
 * or a Spotify album or playlist ({ importUrl }, DJs).
 */
const addItemsBody = z
  .object({ input: song.optional(), importUrl: link.optional() })
  .strict()
  .refine((body) => (body.input === undefined) !== (body.importUrl === undefined), 'Send either "input" or "importUrl".');
const renameBody = z.object({ name }).strict();
const moveBody = z.object({ position: z.number().int().min(1) }).strict();
const playBody = z.object({ mode: z.enum(["replace", "append"]) }).strict();

/**
 * The website's Playlists tab. Like the player routes, each one checks permission, reads its input and calls
 * PlaylistManager, which holds the rules (names, limits, whose song may be removed).
 *
 * Members may look, add songs, and remove the songs they added; everything else needs a DJ. Only "play" controls
 * playback, so only it follows the server's `requireSameVoiceChannel` setting.
 * Changes answer with the changed playlist (or the list); open pages also get a `playlists:update` on the socket.
 */
export function playlistRoutes({ client, players, playlists, settings }: WebContext): Router {
  const router = Router();
  const ctx = { client, settings };
  const editing = { controlsPlayback: false };

  // ---- The list ----

  router.get(
    "/guilds/:id/playlists",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, ctx, "member");
      res.json(playlists.list(guild.id));
    }),
  );

  router.post(
    "/guilds/:id/playlists",
    route(async (req, res) => {
      const { guild, user } = await requireGuildAccess(req, ctx, "dj", editing);
      const body = parseBody(createBody, req.body);
      const createdBy = { id: user.id, name: user.name };
      const playlist =
        body.importUrl !== undefined
          ? (await playlists.createFromLink(guild.id, body.name ?? null, body.importUrl, createdBy)).playlist
          : playlists.create(guild.id, body.name!, createdBy); // the schema makes sure there's a name
      res.json(playlists.get(guild.id, playlist.id));
    }),
  );

  router.post(
    "/guilds/:id/playlists/from-queue",
    route(async (req, res) => {
      const { guild, user } = await requireGuildAccess(req, ctx, "dj", editing);
      const body = parseBody(renameBody, req.body);
      const playlist = playlists.saveQueue(guild.id, body.name, { id: user.id, name: user.name });
      res.json(playlists.get(guild.id, playlist.id));
    }),
  );

  // ---- One playlist ----

  router.get(
    "/guilds/:id/playlists/:playlistId",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, ctx, "member");
      res.json(playlists.get(guild.id, playlistIdOf(req)));
    }),
  );

  router.patch(
    "/guilds/:id/playlists/:playlistId",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, ctx, "dj", editing);
      const body = parseBody(renameBody, req.body);
      const playlist = playlists.rename(guild.id, playlistIdOf(req), body.name);
      res.json(playlists.get(guild.id, playlist.id));
    }),
  );

  router.delete(
    "/guilds/:id/playlists/:playlistId",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, ctx, "dj", editing);
      playlists.delete(guild.id, playlistIdOf(req));
      res.json(playlists.list(guild.id));
    }),
  );

  router.post(
    "/guilds/:id/playlists/:playlistId/play",
    route(async (req, res) => {
      const { guild, user } = await requireGuildAccess(req, ctx, "dj");
      const body = parseBody(playBody, req.body);
      const { result } = await playlists.play(guild.id, playlistIdOf(req), body.mode, {
        requestedBy: { id: user.id, name: user.name, via: "web" },
        // The bot joins the voice channel the user is in, like with /playlist play.
        voiceChannelId: guild.voiceStates.cache.get(user.id)?.channelId ?? null,
        textChannelId: null,
      });
      res.json({ result, state: players.getState(guild.id) });
    }),
  );

  // ---- Songs ----

  router.post(
    "/guilds/:id/playlists/:playlistId/items",
    route(async (req, res) => {
      const { guild, user } = await requireGuildAccess(req, ctx, "member");
      const body = parseBody(addItemsBody, req.body);
      const playlistId = playlistIdOf(req);
      if (body.importUrl !== undefined) {
        // Anyone may add a song, but importing a whole playlist is for DJs.
        await requireGuildAccess(req, ctx, "dj", editing);
        await playlists.importInto(guild.id, playlistId, body.importUrl, { id: user.id, name: user.name });
      } else {
        await playlists.addSong(guild.id, playlistId, body.input!, { id: user.id, name: user.name, via: "web" });
      }
      res.json(playlists.get(guild.id, playlistId));
    }),
  );

  router.delete(
    "/guilds/:id/playlists/:playlistId/items/:itemId",
    route(async (req, res) => {
      // Members may remove the songs they added; PlaylistManager checks whose song it is.
      const { guild, user, level } = await requireGuildAccess(req, ctx, "member");
      const playlistId = playlistIdOf(req);
      playlists.removeSong(guild.id, playlistId, numberParam(req, "itemId"), { id: user.id, isDj: hasLevel(level, "dj") });
      res.json(playlists.get(guild.id, playlistId));
    }),
  );

  router.patch(
    "/guilds/:id/playlists/:playlistId/items/:itemId",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, ctx, "dj", editing);
      const body = parseBody(moveBody, req.body);
      const playlistId = playlistIdOf(req);
      playlists.moveSong(guild.id, playlistId, numberParam(req, "itemId"), body.position);
      res.json(playlists.get(guild.id, playlistId));
    }),
  );

  return router;
}

function playlistIdOf(req: Request): number {
  return numberParam(req, "playlistId");
}

/** A numeric id from the URL. Anything else can't be a playlist or a song, so it's a 404. */
function numberParam(req: Request, param: string): number {
  const value = Number(req.params[param]);
  if (!Number.isSafeInteger(value) || value < 1) throw new HttpError(404, "Not found");
  return value;
}
