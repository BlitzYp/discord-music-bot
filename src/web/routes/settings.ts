import { ChannelType, type Guild, PermissionFlagsBits } from "discord.js";
import { Router } from "express";
import { z } from "zod";
import { UserError } from "../../player/errors.js";
import { type GuildSettingsResponse, SETTING_LIMITS } from "../../shared/settings.js";
import { requireGuildAccess } from "../access.js";
import { parseBody, route } from "../http.js";
import type { WebContext } from "../server.js";

const snowflake = z.string().regex(/^\d+$/, "must be a Discord id");
const whole = (limits: { min: number; max: number }) => z.number().int().min(limits.min).max(limits.max);

/** What PATCH /guilds/:id/settings accepts: any of the settings, each checked. Unknown keys are refused. */
const guildSettingsChanges = z
  .object({
    djRoleId: snowflake.nullable(),
    defaultVolume: whole(SETTING_LIMITS.defaultVolume),
    maxQueueLength: whole(SETTING_LIMITS.maxQueueLength).nullable(),
    maxTrackDurationSec: whole(SETTING_LIMITS.maxTrackDurationSec).nullable(),
    requireSameVoiceChannel: z.boolean(),
    leaveWhenEmptyAfterSec: whole(SETTING_LIMITS.leaveWhenEmptyAfterSec),
    announceChannelId: snowflake.nullable(),
  })
  .partial()
  .strict();

/** A server's settings page. Server admins only (and the owner). */
export function settingsRoutes({ client, settings }: WebContext): Router {
  const router = Router();

  router.get(
    "/guilds/:id/settings",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, { client, settings }, "admin");
      res.json(settingsResponse(guild, settings.guild(guild.id)));
    }),
  );

  router.patch(
    "/guilds/:id/settings",
    route(async (req, res) => {
      const { guild, user } = await requireGuildAccess(req, { client, settings }, "admin");
      const changes = parseBody(guildSettingsChanges, req.body);

      // The ids must belong to this server, so nobody can point a setting at another server's role or channel.
      if (changes.djRoleId && !guild.roles.cache.has(changes.djRoleId)) throw new UserError("That role isn't in this server.");
      if (changes.announceChannelId && !announceChannels(guild).some((c) => c.id === changes.announceChannelId)) {
        throw new UserError("The bot can't post in that channel.");
      }

      const updated = settings.updateGuild(guild.id, changes);
      console.log(`[web] ${user.name} changed the settings of "${guild.name}": ${JSON.stringify(changes)}`);
      res.json(settingsResponse(guild, updated));
    }),
  );

  return router;
}

function settingsResponse(guild: Guild, guildSettings: GuildSettingsResponse["settings"]): GuildSettingsResponse {
  const roles = [...guild.roles.cache.values()]
    // Roles that belong to bots and integrations can't be given to people, so they'd be useless as the DJ role.
    .filter((role) => !role.managed)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, name: role.name, color: role.color === 0 ? null : role.hexColor }));
  return {
    settings: guildSettings,
    roles,
    textChannels: announceChannels(guild).map((channel) => ({ id: channel.id, name: channel.name })),
  };
}

/** The text channels where the bot may post, sorted by their position in the channel list. */
function announceChannels(guild: Guild) {
  const me = guild.members.me;
  return [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    .filter((channel) => me && channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]))
    .sort((a, b) => a.position - b.position);
}
