import { type Guild, type GuildMember, PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import type { PermissionLevel } from "./shared/permissions.js";

/**
 * Works out a user's permission level in a server (owner, admin, dj or member; see src/shared/permissions.ts).
 * Used by both slash commands and the website, so the rules can't drift apart.
 */
export { hasLevel, LEVEL_NAMES, type PermissionLevel } from "./shared/permissions.js";

/** A member's level. For slash commands, where Discord sends the member (with roles) along with the command. */
export function levelOf(member: GuildMember): PermissionLevel {
  if (config.OWNER_ID && member.id === config.OWNER_ID) return "owner";
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (isAdmin) return "admin";
  return isDj(member) ? "dj" : "member";
}

/**
 * Until per-server settings exist (milestone 6) there's no way to pick a DJ role, so every member counts
 * as a DJ, the same as before permissions existed.
 * Milestone 6: read the server's `djRoleId`. With one set, only members who have that role are DJs;
 * with none set, nobody is (only admins can control playback), as the design says.
 */
function isDj(_member: GuildMember): boolean {
  return true;
}

const MEMBER_CACHE_MS = 30_000;
const memberCache = new Map<string, { member: GuildMember | null; fetchedAt: number }>();

/**
 * A user's level in a server, or null if they aren't a member. For the website, which only knows the user's id.
 * The member (with roles) is fetched from Discord's API, which needs no privileged intent, and cached for 30 s.
 */
export async function getPermissionLevel(guild: Guild, userId: string): Promise<PermissionLevel | null> {
  if (config.OWNER_ID && userId === config.OWNER_ID) return "owner";
  const member = await fetchMember(guild, userId);
  return member ? levelOf(member) : null;
}

async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  const key = `${guild.id}:${userId}`;
  const cached = memberCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < MEMBER_CACHE_MS) return cached.member;

  // Discord answers "Unknown Member" when the user isn't in the server.
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  memberCache.set(key, { member, fetchedAt: Date.now() });
  return member;
}
