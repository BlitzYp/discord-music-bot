import type { SettingsStore } from "../db/settingsStore.js";
import type { AutoAnnouncementKind } from "../shared/settings.js";
import { fillMessage, joinNames } from "../tts/messages.js";
import type { PlayerManager } from "./PlayerManager.js";

/** People who join (or leave) within this long of each other are named in one announcement: "Welcome, Ann and Bob!" */
export const GATHER_MS = 3_000;
/** Someone who joins (or leaves) again within this long isn't announced again, so hopping in and out isn't spammy. */
export const REPEAT_AFTER_MS = 60_000;

type MemberKind = Extract<AutoAnnouncementKind, "memberJoin" | "memberLeave">;

/**
 * The "someone joined" and "someone left" announcements (see AutoAnnouncements in src/shared/settings.ts). The Discord
 * side (src/bot/events/voiceStateUpdate.ts) reports who joined or left the bot's voice channel; this decides whether
 * and when it's said.
 */
export class MemberAnnouncements {
  /** Names waiting to be said, per server and kind (`<guildId>:<kind>`), and the timer that will say them. */
  private readonly gathering = new Map<string, { names: string[]; timer: NodeJS.Timeout }>();
  /** When each person was last announced, per server and kind (`<guildId>:<kind>:<memberId>`). */
  private readonly lastAnnouncedAt = new Map<string, number>();

  constructor(
    private readonly players: Pick<PlayerManager, "announceAutomatically">,
    private readonly settings: Pick<SettingsStore, "guild">,
  ) {}

  memberJoined(guildId: string, member: { id: string; name: string }): void {
    this.note(guildId, "memberJoin", member);
  }

  memberLeft(guildId: string, member: { id: string; name: string }): void {
    this.note(guildId, "memberLeave", member);
  }

  private note(guildId: string, kind: MemberKind, member: { id: string; name: string }): void {
    if (!this.settings.guild(guildId).autoAnnouncements[kind].enabled) return;

    const memberKey = `${guildId}:${kind}:${member.id}`;
    const now = Date.now();
    const last = this.lastAnnouncedAt.get(memberKey);
    if (last !== undefined && now - last < REPEAT_AFTER_MS) return;
    this.lastAnnouncedAt.set(memberKey, now);

    const key = `${guildId}:${kind}`;
    const waiting = this.gathering.get(key);
    if (waiting) {
      waiting.names.push(member.name);
      return;
    }
    const timer = setTimeout(() => this.say(guildId, kind), GATHER_MS);
    this.gathering.set(key, { names: [member.name], timer });
  }

  private say(guildId: string, kind: MemberKind): void {
    const key = `${guildId}:${kind}`;
    const names = this.gathering.get(key)?.names ?? [];
    this.gathering.delete(key);

    // Read again: an admin may have switched it off, or changed the message, in the meantime.
    const announcement = this.settings.guild(guildId).autoAnnouncements[kind];
    if (!announcement.enabled || names.length === 0) return;

    const text = fillMessage(announcement.message, { name: joinNames(names) });
    this.players.announceAutomatically(guildId, text).catch((error: unknown) => {
      console.warn(`[tts] ${guildId}: couldn't say "${text}": ${error instanceof Error ? error.message : error}`);
    });
  }
}
