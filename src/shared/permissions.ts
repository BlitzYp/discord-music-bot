// Permission levels, shared so the website can decide which controls to show. The server still checks
// every change itself (src/permissions.ts); hiding a button is only for convenience.

/**
 * - owner: the bot owner (OWNER_ID): everything, in every server.
 * - admin: Administrator or Manage Server in that server: settings and all controls.
 * - dj: may control playback.
 * - member: may only look.
 * Each level includes the ones below it.
 */
export type PermissionLevel = "member" | "dj" | "admin" | "owner";

const RANK: Record<PermissionLevel, number> = { member: 0, dj: 1, admin: 2, owner: 3 };

export function hasLevel(level: PermissionLevel, required: PermissionLevel): boolean {
  return RANK[level] >= RANK[required];
}

/** Words for "you need to be …" messages. */
export const LEVEL_NAMES: Record<PermissionLevel, string> = {
  member: "a member of this server",
  dj: "a DJ",
  admin: "a server admin",
  owner: "the bot owner",
};
