import { Router } from "express";
import type { LavalinkManager } from "lavalink-client";
import { z } from "zod";
import { currentStatus } from "../../bot/presence.js";
import { ffmpegVersion } from "../../library/ffmpeg.js";
import { updateYtDlp, ytDlpVersion } from "../../player/resolvers/ytdlp.js";
import {
  type AdminStatus,
  BOT_STATUS_DOTS,
  BOT_STATUS_TYPES,
  GLOBAL_SETTING_LIMITS,
  MAX_BOT_STATUS_LENGTH,
  YOUTUBE_MODES,
} from "../../shared/settings.js";
import { requireOwner } from "../access.js";
import { parseBody, route } from "../http.js";
import type { WebContext } from "../server.js";

const whole = (limits: { min: number; max: number }) => z.number().int().min(limits.min).max(limits.max);

/** What PATCH /admin/settings accepts. Unknown keys are refused. */
const globalSettingsChanges = z
  .object({
    youtubeMode: z.enum(YOUTUBE_MODES),
    ytdlpAutoUpdate: z.boolean(),
    maxUploadMb: whole(GLOBAL_SETTING_LIMITS.maxUploadMb),
    guildQuotaMb: whole(GLOBAL_SETTING_LIMITS.guildQuotaMb),
    // null goes back to the automatic status.
    statusOverride: z
      .object({
        type: z.enum(BOT_STATUS_TYPES),
        text: z.string().trim().min(1, "type the status text").max(MAX_BOT_STATUS_LENGTH),
        dot: z.enum(BOT_STATUS_DOTS),
      })
      .strict()
      .nullable(),
  })
  .partial()
  .strict();

/** The bot owner's Admin page: global settings and the status of each part. Owner only (OWNER_ID). */
export function adminRoutes({ client, players, settings }: WebContext): Router {
  const router = Router();

  router.get(
    "/admin/settings",
    route(async (req, res) => {
      requireOwner(req);
      res.json(settings.global());
    }),
  );

  router.patch(
    "/admin/settings",
    route(async (req, res) => {
      requireOwner(req);
      const changes = parseBody(globalSettingsChanges, req.body);
      const updated = settings.updateGlobal(changes);
      console.log(`[web] the owner changed the global settings: ${JSON.stringify(changes)}`);
      res.json(updated);
    }),
  );

  router.get(
    "/admin/status",
    route(async (req, res) => {
      requireOwner(req);
      const status: AdminStatus = {
        bot: {
          uptimeMs: Math.round(process.uptime() * 1000),
          servers: client.guilds.cache.size,
          activePlayers: players.lavalink.players.size,
        },
        lavalink: lavalinkStatus(players.lavalink),
        ytdlp: { version: await ytDlpVersion().catch(() => null) },
        ffmpeg: { version: await ffmpegVersion().catch(() => null) },
        discordStatus: currentStatus(client, players, settings),
      };
      res.json(status);
    }),
  );

  /** Updates yt-dlp now, without restarting the bot. Takes a few seconds. */
  router.post(
    "/admin/ytdlp/update",
    route(async (req, res) => {
      requireOwner(req);
      res.json({ message: await updateYtDlp() });
    }),
  );

  return router;
}

function lavalinkStatus(lavalink: LavalinkManager): AdminStatus["lavalink"] {
  const node = [...lavalink.nodeManager.nodes.values()][0];
  // The numbers are only current while connected; otherwise they're left over from the last connection.
  if (!node?.connected) {
    return {
      connected: false,
      version: null,
      youtubePluginVersion: null,
      players: null,
      playingPlayers: null,
      uptimeMs: null,
      memoryUsedMb: null,
    };
  }
  const youtubePlugin = node.info?.plugins.find((plugin) => plugin.name.includes("youtube"));
  return {
    connected: true,
    version: node.info?.version.semver ?? null,
    youtubePluginVersion: youtubePlugin?.version ?? null,
    players: node.stats.players,
    playingPlayers: node.stats.playingPlayers,
    uptimeMs: node.stats.uptime,
    memoryUsedMb: Math.round(node.stats.memory.used / 1024 / 1024),
  };
}
