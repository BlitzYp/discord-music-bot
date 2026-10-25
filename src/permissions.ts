import { type Guild, type GuildMember, PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import type { SettingsStore } from "./db/settingsStore.js";
import type { PermissionLevel } from "./shared/permissions.js";

/**
 * Works out a user's permission level in a server (owner, admin, dj or member; see src/shared/permissions.ts).
 * Used by both slash commands and the website, so the rules can't drift apart.
 */
export { hasLevel, LEVEL_NAMES, type PermissionLevel } from "./shared/permissions.js";

/** A member's level. For slash commands, where Discord sends the member (with roles) along with the command. */
export function levelOf(member: GuildMember, settings: SettingsStore): PermissionLevel {
  if (config.OWNER_ID && member.id === config.OWNER_ID) return "owner";
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (isAdmin) return "admin";
  return isDj(member, settings.guild(member.guild.id).djRoleId) ? "dj" : "member";
}

/**
 * Whether a member has the server's DJ role. With no DJ role picked, nobody is a DJ, so only admins can
 * control playback until an admin picks one on the website's Settings page.
 */
function isDj(member: GuildMember, djRoleId: string | null): boolean {
  if (djRoleId === null) return false;
  // The @everyone role has the server's id. Everyone has it, so picking it makes every member a DJ.
  if (djRoleId === member.guild.id) return true;
  return member.roles.cache.has(djRoleId);
}

/**
 * The server's `requireSameVoiceChannel` setting: while the bot is in a voice channel, DJs must be in that
 * channel to control playback. Admins and the owner don't. Returns why the user can't, or null if they can.
 */
export function voiceChannelProblem(
  guild: Guild,
  userId: string,
  level: PermissionLevel,
  settings: SettingsStore,
): string | null {
  if (level !== "dj" || !settings.guild(guild.id).requireSameVoiceChannel) return null;

  // While the bot isn't in voice, the usual rule applies: it joins the channel of whoever starts playback.
  const botChannelId = guild.members.me?.voice.channelId;
  if (!botChannelId) return null;

  const userChannelId = guild.voiceStates.cache.get(userId)?.channelId;
  if (userChannelId === botChannelId) return null;
  const channelName = guild.channels.cache.get(botChannelId)?.name ?? "the bot's channel";
  return `Join the bot's voice channel (${channelName}) to control playback.`;
}

const MEMBER_CACHE_MS = 30_000;
const memberCache = new Map<string, { member: GuildMember | null; fetchedAt: number }>();

/**
 * A user's level in a server, or null if they aren't a member. For the website, which only knows the user's id.
 * The member (with roles) is fetched from Discord's API, which needs no privileged intent, and cached for 30 s.
 * The DJ role setting is read fresh every time, so changing it applies at once.
 */
export async function getPermissionLevel(guild: Guild, userId: string, settings: SettingsStore): Promise<PermissionLevel | null> {
  if (config.OWNER_ID && userId === config.OWNER_ID) return "owner";
  const member = await fetchMember(guild, userId);
  return member ? levelOf(member, settings) : null;
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
