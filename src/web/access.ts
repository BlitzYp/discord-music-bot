import type { Guild } from "discord.js";
import type { Request } from "express";
import { config } from "../config.js";
import { getPermissionLevel, hasLevel, LEVEL_NAMES, type PermissionLevel, voiceChannelProblem } from "../permissions.js";
import type { SessionUser } from "../shared/types.js";
import { HttpError } from "./http.js";
import { integrationKeyMatches, integrationUserOf } from "./integration.js";
import type { WebContext } from "./server.js";
import { sessionUserOf } from "./session.js";

/**
 * The logged-in user, or the person Jarvis is acting for (integration key + acting-user headers, see
 * integration.ts). Throws 401 if it's neither.
 */
export function requireUser(req: Request): SessionUser {
  const user = integrationUserOf(req.headers, config.INTEGRATION_KEY) ?? sessionUserOf(req);
  if (!user) throw new HttpError(401, "Log in with Discord first.");
  return user;
}

/** Throws 401 unless the request carries the integration key. For routes only Jarvis calls, like ducking. */
export function requireIntegration(req: Request): void {
  if (!integrationKeyMatches(req.headers.authorization, config.INTEGRATION_KEY)) {
    throw new HttpError(401, "This needs the integration key.");
  }
}

/** The logged-in user, if they're the bot owner (OWNER_ID). Throws 401 or 403 otherwise. Every /admin route starts with this. */
export function requireOwner(req: Request): SessionUser {
  // The admin pages are for the owner in a browser, never for the integration key, even acting as the owner.
  if (integrationKeyMatches(req.headers.authorization, config.INTEGRATION_KEY)) {
    throw new HttpError(403, "The integration key can't use the admin pages.");
  }
  const user = requireUser(req);
  if (!isOwner(user.id)) throw new HttpError(403, "Only the bot owner can do that.");
  return user;
}

export function isOwner(userId: string): boolean {
  return config.OWNER_ID !== undefined && userId === config.OWNER_ID;
}

export interface GuildAccess {
  guild: Guild;
  user: SessionUser;
  level: PermissionLevel;
}

/**
 * Checks that the logged-in user may do something in the server named by the `:id` route parameter.
 * Every guild route starts with this, so no route can forget the check.
 * Throws 401 (not logged in), 404 (the bot isn't in that server, or the user isn't either) or 403 (level too low,
 * or, for DJ actions that control playback, not in the bot's voice channel when the server requires that).
 *
 * `controlsPlayback` says whether the server's `requireSameVoiceChannel` setting applies. By default it does for
 * every "dj" route; DJ routes that don't touch playback (editing playlists) pass `{ controlsPlayback: false }`.
 */
export async function requireGuildAccess(
  req: Request,
  { client, settings }: Pick<WebContext, "client" | "settings">,
  required: PermissionLevel,
  { controlsPlayback = required === "dj" }: { controlsPlayback?: boolean } = {},
): Promise<GuildAccess> {
  const user = requireUser(req);
  const guild = client.guilds.cache.get(req.params.id as string);
  if (!guild) throw new HttpError(404, "The bot isn't in that server.");

  const level = await getPermissionLevel(guild, user.id, settings);
  // Same answer as "no such server", so the website doesn't reveal which servers the bot is in.
  if (!level) throw new HttpError(404, "The bot isn't in that server.");
  if (!hasLevel(level, required)) throw new HttpError(403, `You need to be ${LEVEL_NAMES[required]} to do that.`);

  if (controlsPlayback) {
    const problem = voiceChannelProblem(guild, user.id, level, settings);
    if (problem) throw new HttpError(403, problem);
  }
  return { guild, user, level };
}
